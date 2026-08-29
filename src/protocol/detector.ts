import type { Blendshapes, FrameQuality, HeadPose } from "../types";
import type { FaceMetrics } from "../vision/geometry";
import { poseDelta, poseWithinTolerance, POSE_TOLERANCE } from "../vision/pose";
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

/** First gate that failed on a frame. Null when all gates passed. */
export type GateId = "face" | "pose" | "sharpness" | "interocular" | "clipping";

/** One point of the time series; goes into the manifest. */
export interface DriveSample {
  t: number;
  drive: number;
  suppress: number;
  /**
   * Set when the frame failed a gate. Without this the manifest cannot say
   * why a strong movement neither triggered nor updated the apex - a six-
   * second stretch of good drive died invisibly that way (run 2026-08-28).
   */
  gate?: GateId;
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
  /** Rest pose frozen during alignment. The pose gate measures against it;
   *  without one it falls back to the camera axis. */
  restPose?: HeadPose | null;
  /** Rest metrics from the same moment - the reference for `geomRel`. */
  restMetrics?: FaceMetrics | null;
  /**
   * Off, `triggered` reports the momentary hold condition and never latches -
   * dev mode shows when the trigger would fire without firing it.
   */
  latchTrigger?: boolean;
}

const DEFAULTS = {
  satisfyRatio: 0.8,
  bestThrottleMs: 120,
  bestMinDelta: 0.02,
  restPose: null,
  restMetrics: null,
  latchTrigger: true,
} as const;

/** Cap on the drive series. With auto-advance off a position can be held for
 *  minutes; only the most recent stretch goes into the manifest. */
const MAX_SERIES = 4000;

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

  update(sample: DetectorSample, canCapture = true): DetectorReading {
    this.startedAt ??= sample.timestampMs;

    const rest = this.options.restMetrics;
    const drive = evaluateSignal(this.spec.drive, sample.blendshapes, sample.metrics, rest);
    const suppress = this.spec.suppress
      ? evaluateSignal(this.spec.suppress, sample.blendshapes, sample.metrics, rest)
      : 0;

    // Gates: what fails here is unusable as a measurement image, however
    // well the movement was performed. Pose relative to the rest pose - see
    // poseDelta for why absolute gating failed.
    const gatePose = this.options.restPose
      ? poseDelta(sample.pose, this.options.restPose)
      : sample.pose;
    const faceOk = sample.faceCount === 1;
    const poseOk = poseWithinTolerance(gatePose, POSE_TOLERANCE);
    const sharpnessOk = sample.quality.sharpness >= QUALITY_THRESHOLDS.minSharpness;
    const interocularOk = sample.quality.interocular >= QUALITY_THRESHOLDS.minInterocular;
    const clippingOk = sample.quality.clippingBright <= QUALITY_THRESHOLDS.maxClippingBright;
    const failedGate: GateId | null = !faceOk
      ? "face"
      : !poseOk
        ? "pose"
        : !sharpnessOk
          ? "sharpness"
          : !interocularOk
            ? "interocular"
            : !clippingOk
              ? "clipping"
              : null;
    const gatesOk = failedGate === null;

    this.series.push({ t: sample.timestampMs, drive, suppress, ...(failedGate ? { gate: failedGate } : {}) });
    if (this.series.length > MAX_SERIES) this.series.shift();

    const satisfied = gatesOk && drive >= this.spec.minDrive && suppress <= this.spec.maxSuppress;
    this.push(sample.timestampMs, satisfied);

    const holdRatio = this.holdRatio();
    const holdMet =
      this.windowSpan() >= this.spec.holdMs * 0.9 && holdRatio >= this.options.satisfyRatio;
    if (holdMet && this.options.latchTrigger) this.hasTriggered = true;

    // Apex without a minDrive condition - see the header. `canCapture` comes
    // from the caller: while a still is being encoded, the best must NOT
    // advance, or the apex is consumed unstored and never retried - that is
    // how a forced eye closure exported with open eyes (run 2026-08-28).
    let isNewBest = false;
    if (
      canCapture &&
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
      triggered: this.options.latchTrigger ? this.hasTriggered : holdMet,
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
