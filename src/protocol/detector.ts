import type { Blendshapes, FrameQuality, HeadPose } from "../types";
import type { FaceMetrics } from "../vision/geometry";
import { poseWithinTolerance, POSE_TOLERANCE } from "../vision/pose";
import { QUALITY_THRESHOLDS } from "../vision/quality";
import { evaluateSignal, type PositionSpec } from "./positions";

/**
 * Detects per position whether the movement is performed and finds the apex.
 *
 * Two points that are not obvious:
 *
 * 1. The hold window asks for a quota, not for uninterrupted fulfilment. A
 *    single outlier must not reset a nearly complete window.
 *
 * 2. The apex is searched over *all* frames with usable pose and sharpness,
 *    not only those reaching `minDrive`. Someone who cannot perform the
 *    movement still gets their best attempt recorded.
 */

export interface DetectorSample {
  timestampMs: number;
  blendshapes: Blendshapes;
  metrics: FaceMetrics;
  pose: HeadPose;
  quality: FrameQuality;
  faceCount: number;
}

export interface DetectorReading {
  /** Strength of the required movement, 0..1. */
  drive: number;
  /** Strength of the unwanted accompanying movement, 0..1. */
  suppress: number;
  /** Pose, sharpness and face count acceptable? */
  gatesOk: boolean;
  /** And drive/suppress within limits? */
  satisfied: boolean;
  /** Share of satisfied frames in the hold window, 0..1. */
  holdRatio: number;
  /** Hold window completed and quota met. */
  triggered: boolean;
  /** Best frame so far - capture a still now. */
  isNewBest: boolean;
  bestDrive: number;
}

/** One point of the time series; goes into the manifest. */
export interface DriveSample {
  t: number;
  drive: number;
  suppress: number;
}

interface WindowEntry {
  t: number;
  satisfied: boolean;
}

export interface DetectorOptions {
  /** Required share of satisfied frames. */
  satisfyRatio?: number;
  /** Minimum gap between two stills, in milliseconds. */
  bestThrottleMs?: number;
  /** Improvement required for a new apex to count. */
  bestMinDelta?: number;
}

const DEFAULTS = {
  satisfyRatio: 0.8,
  bestThrottleMs: 120,
  bestMinDelta: 0.02,
} as const;

export class PositionDetector {
  private readonly window: WindowEntry[] = [];
  private readonly series: DriveSample[] = [];
  private best = -1;
  private lastBestAt = -Infinity;
  private startedAt: number | null = null;
  private hasTriggered = false;
  private readonly options: Required<DetectorOptions>;

  constructor(
    readonly spec: PositionSpec,
    options: DetectorOptions = {},
  ) {
    this.options = { ...DEFAULTS, ...options };
  }

  /** Resets the state for a new attempt. */
  reset(): void {
    this.window.length = 0;
    this.series.length = 0;
    this.best = -1;
    this.lastBestAt = -Infinity;
    this.startedAt = null;
    this.hasTriggered = false;
  }

  /** Time series of the attempt. */
  get driveSeries(): readonly DriveSample[] {
    return this.series;
  }

  get bestDrive(): number {
    return this.best;
  }

  /** Frame without a usable face. Counts as not satisfied. */
  updateMissing(timestampMs: number): DetectorReading {
    this.push(timestampMs, false);
    return {
      drive: 0,
      suppress: 0,
      gatesOk: false,
      satisfied: false,
      holdRatio: this.holdRatio(),
      triggered: this.hasTriggered,
      isNewBest: false,
      bestDrive: this.best,
    };
  }

  update(sample: DetectorSample): DetectorReading {
    this.startedAt ??= sample.timestampMs;

    const drive = evaluateSignal(this.spec.drive, sample.blendshapes, sample.metrics);
    const suppress = this.spec.suppress
      ? evaluateSignal(this.spec.suppress, sample.blendshapes, sample.metrics)
      : 0;

    this.series.push({ t: sample.timestampMs, drive, suppress });

    // Gates: what fails here is unusable as a measurement image, however
    // well the movement was performed.
    const gatesOk =
      sample.faceCount === 1 &&
      poseWithinTolerance(sample.pose, POSE_TOLERANCE) &&
      sample.quality.sharpness >= QUALITY_THRESHOLDS.minSharpness &&
      sample.quality.interocular >= QUALITY_THRESHOLDS.minInterocular &&
      sample.quality.clipping <= QUALITY_THRESHOLDS.maxClipping;

    const satisfied = gatesOk && drive >= this.spec.minDrive && suppress <= this.spec.maxSuppress;
    this.push(sample.timestampMs, satisfied);

    const holdRatio = this.holdRatio();
    if (this.windowSpan() >= this.spec.holdMs * 0.9 && holdRatio >= this.options.satisfyRatio) {
      this.hasTriggered = true;
    }

    // Apex without a minDrive condition - see the header.
    let isNewBest = false;
    if (
      gatesOk &&
      drive > this.best + this.options.bestMinDelta &&
      sample.timestampMs - this.lastBestAt >= this.options.bestThrottleMs
    ) {
      this.best = drive;
      this.lastBestAt = sample.timestampMs;
      isNewBest = true;
    }

    return {
      drive,
      suppress,
      gatesOk,
      satisfied,
      holdRatio,
      triggered: this.hasTriggered,
      isNewBest,
      bestDrive: this.best,
    };
  }

  private push(t: number, satisfied: boolean): void {
    this.window.push({ t, satisfied });
    const cutoff = t - this.spec.holdMs;
    while (this.window.length > 0 && this.window[0]!.t < cutoff) this.window.shift();
  }

  private windowSpan(): number {
    if (this.window.length < 2) return 0;
    return this.window[this.window.length - 1]!.t - this.window[0]!.t;
  }

  private holdRatio(): number {
    if (this.window.length === 0) return 0;
    let ok = 0;
    for (const e of this.window) if (e.satisfied) ok++;
    return ok / this.window.length;
  }
}
