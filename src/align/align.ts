import type { FaceMetrics } from "../vision/geometry";
import type { FrameQuality, HeadPose } from "../types";
import { issueText, qualityIssues } from "../vision/quality";
import { poseDelta, poseWithinTolerance, POSE_TOLERANCE } from "../vision/pose";

/**
 * Alignment: what both pages share before anything is recorded.
 *
 * Kept in one place on purpose. This is the part with the subtlest failure
 * modes - a page that aligns by one set of rules and measures by another
 * produces data that cannot be compared, and nothing in the output would say
 * so.
 */

/** How long alignment must hold before recording is released. */
export const ALIGN_HOLD_MS = 1200;

/** Smoothing of the rest baseline. Small, so one bad frame cannot move it. */
const REST_EMA = 0.1;

const mix = (a: number, b: number): number => a + (b - a) * REST_EMA;

export interface RestSnapshot {
  pose: HeadPose;
  metrics: FaceMetrics;
  /** Frames that went into the average - says how settled it is. */
  samples: number;
}

/** Face box in normalised coordinates, averaged the same way. */
export interface FaceBoxSnapshot {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  samples: number;
}

/**
 * What makes a frame unusable, as display text.
 *
 * `reference` null gates against the camera axis (alignment phase); with a
 * rest pose it gates against that instead - a camera off eye level put the
 * resting head near the absolute limit and expressions tilted it past
 * (measured 2026-08-28).
 */
export function collectIssues(
  faceCount: number,
  pose: HeadPose | null,
  quality: FrameQuality | null,
  reference: HeadPose | null,
): string[] {
  if (faceCount === 0) return [issueText("no-face")];
  if (faceCount > 1) return [issueText("multiple-faces")];
  const out = quality ? qualityIssues(quality).map(issueText) : [];
  if (pose) {
    const gauged = reference ? poseDelta(pose, reference) : pose;
    if (!poseWithinTolerance(gauged, POSE_TOLERANCE)) out.push(issueText("head-tilted"));
  }
  return out;
}

/** Running average of pose and all face metrics over the clean frames. */
export class RestBaseline {
  private pose: HeadPose | null = null;
  private metrics: FaceMetrics | null = null;
  private count = 0;

  add(pose: HeadPose, metrics: FaceMetrics): void {
    this.pose = this.pose
      ? {
          yaw: mix(this.pose.yaw, pose.yaw),
          pitch: mix(this.pose.pitch, pose.pitch),
          roll: mix(this.pose.roll, pose.roll),
        }
      : { ...pose };

    if (this.metrics) {
      const mixed = { ...this.metrics };
      for (const key of Object.keys(mixed) as (keyof FaceMetrics)[]) {
        mixed[key] = mix(this.metrics[key], metrics[key]);
      }
      this.metrics = mixed;
    } else {
      this.metrics = { ...metrics };
    }
    this.count += 1;
  }

  get snapshot(): RestSnapshot | null {
    return this.pose && this.metrics
      ? { pose: this.pose, metrics: this.metrics, samples: this.count }
      : null;
  }

  reset(): void {
    this.pose = null;
    this.metrics = null;
    this.count = 0;
  }
}

/**
 * Running average of the face box - the basis of the video crop.
 *
 * Same smoothing as the rest baseline, so both describe the same stretch of
 * time.
 */
export class FaceBoxBaseline {
  private box: FaceBoxSnapshot | null = null;

  add(quality: FrameQuality): void {
    this.box = this.box
      ? {
          centerX: mix(this.box.centerX, quality.centerX),
          centerY: mix(this.box.centerY, quality.centerY),
          width: mix(this.box.width, quality.boxWidth),
          height: mix(this.box.height, quality.boxHeight),
          samples: this.box.samples + 1,
        }
      : {
          centerX: quality.centerX,
          centerY: quality.centerY,
          width: quality.boxWidth,
          height: quality.boxHeight,
          samples: 1,
        };
  }

  get snapshot(): FaceBoxSnapshot | null {
    return this.box;
  }

  reset(): void {
    this.box = null;
  }
}

/**
 * Hold condition: uninterrupted clean frames for `holdMs`.
 *
 * A single complaint resets the timer - alignment is the one place where
 * "mostly fine" is not good enough, because everything downstream measures
 * against what is frozen here.
 */
export class AlignGate {
  private okSince: number | null = null;

  constructor(private readonly holdMs: number = ALIGN_HOLD_MS) {}

  /** True once held long enough without complaint. */
  update(issueCount: number, nowMs: number): boolean {
    if (issueCount > 0) {
      this.okSince = null;
      return false;
    }
    this.okSince ??= nowMs;
    return nowMs - this.okSince >= this.holdMs;
  }

  reset(): void {
    this.okSince = null;
  }
}
