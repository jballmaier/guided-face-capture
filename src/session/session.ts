import { captureStill, type Still, type StillOptions } from "../capture/stills";
import { SequenceRecorder, type Recording } from "../capture/recorder";
import { PositionDetector, type DetectorReading, type DetectorSample, type DriveSample } from "../protocol/detector";
import { POSITIONS, type PositionId, type PositionSpec } from "../protocol/positions";
import { tunedSpec, tuningOf, type PositionTuning } from "../protocol/tuning";
import type { Blendshapes, FrameQuality, HeadPose } from "../types";
import type { FaceMetrics } from "../vision/geometry";

/**
 * Guides through the positions and keeps the best still for each.
 *
 * The apex cannot be fetched afterwards - the frame is gone. A ring buffer of
 * full frames is the alternative and is out: 1920x1080 RGBA is about 8 MB per
 * frame, a second of history a quarter gigabyte.
 *
 * So a still is encoded whenever a new best is reached and the previous one is
 * dropped.
 */

/** Lead-in per position. Nothing is measured here, or the transition movement
 *  ends up in the apex. */
const PREPARE_MS = 1600;

/** Move on after this even without a trigger, so nobody gets stuck on a
 *  movement they cannot perform. */
const MAX_MEASURE_MS = 12_000;

/** Brief confirmation after triggering, so the switch does not surprise. */
const CONFIRM_MS = 700;

export type SessionPhase = "idle" | "prepare" | "measure" | "confirm" | "review" | "finished";

export interface ApexRecord {
  drive: number;
  atMs: number;
  blendshapes: Blendshapes;
  metrics: FaceMetrics;
  pose: HeadPose;
  quality: FrameQuality;
}

export interface PositionResult {
  spec: PositionSpec;
  still: Still | null;
  apex: ApexRecord | null;
  driveSeries: DriveSample[];
  /** Triggered automatically - not by button, not by timeout. */
  triggered: boolean;
  capturedManually: boolean;
  timedOut: boolean;
  attempts: number;
  /**
   * Thresholds this position was actually measured under, recorded on entering
   * the measure phase: calibrating mid-run changes them between positions.
   */
  thresholds: PositionTuning;
}

export interface SessionView {
  phase: SessionPhase;
  spec: PositionSpec | null;
  /** 0..1 - lead-in or hold progress, depending on phase. */
  progress: number;
  reading: DetectorReading | null;
  positionNumber: number;
  positionCount: number;
}

export interface SessionOptions {
  still?: StillOptions;
  videoBitsPerSecond?: number;
}

export interface SessionResult {
  recording: Recording;
  results: PositionResult[];
  startedAt: string;
  durationMs: number;
}

export class CaptureSession {
  private readonly recorder: SequenceRecorder;
  private readonly results = new Map<PositionId, PositionResult>();
  private readonly order: PositionSpec[] = [...POSITIONS];

  private index = 0;
  private phase: SessionPhase = "idle";
  private phaseUntil = 0;
  private detector: PositionDetector | null = null;
  private startedAtIso = "";

  /** Stops a late, worse still from overwriting a better one - toBlob is async. */
  private captureToken = 0;
  private storedToken = new Map<PositionId, number>();

  /**
   * Guard against stacking encodes.
   *
   * A twelve-megapixel JPEG costs hundredths of a second on a phone, and a new
   * best arrives constantly during a movement. Without the guard the frame
   * rate collapses, and with it the detection.
   *
   * Price: an apex falling into a running encode is skipped.
   */
  private capturing = false;

  constructor(
    private readonly video: HTMLVideoElement,
    stream: MediaStream,
    private readonly options: SessionOptions = {},
  ) {
    const bits = options.videoBitsPerSecond;
    this.recorder = new SequenceRecorder(stream, bits === undefined ? {} : { videoBitsPerSecond: bits });
  }

  get currentSpec(): PositionSpec | null {
    return this.order[this.index] ?? null;
  }

  get allResults(): PositionResult[] {
    return this.order.map((spec) => this.results.get(spec.id) ?? blankResult(spec));
  }

  get elapsedMs(): number {
    return this.recorder.elapsedMs;
  }

  start(): void {
    this.startedAtIso = new Date().toISOString();
    this.recorder.start();
    this.index = 0;
    this.enterPrepare();
  }

  /** One analysed frame. Returns the state for the interface. */
  update(sample: DetectorSample | null, nowMs: number): SessionView {
    const spec = this.currentSpec;
    if (!spec || this.phase === "idle" || this.phase === "review" || this.phase === "finished") {
      return this.view(null, 0);
    }

    if (this.phase === "prepare") {
      const remaining = this.phaseUntil - nowMs;
      if (remaining <= 0) this.enterMeasure();
      return this.view(null, 1 - Math.max(0, remaining) / PREPARE_MS);
    }

    if (this.phase === "confirm") {
      if (nowMs >= this.phaseUntil) this.advance();
      return this.view(null, 1);
    }

    // Measure phase
    const detector = this.detector;
    if (!detector) return this.view(null, 0);

    const reading = sample ? detector.update(sample) : detector.updateMissing(nowMs);

    if (sample && reading.isNewBest && !this.capturing) {
      void this.storeBest(spec, sample, reading.drive);
    }

    if (reading.triggered) {
      this.markTriggered(spec);
      this.phase = "confirm";
      this.phaseUntil = nowMs + CONFIRM_MS;
      return this.view(reading, 1);
    }

    if (nowMs >= this.phaseUntil) {
      this.markTimedOut(spec);
      this.phase = "confirm";
      this.phaseUntil = nowMs + CONFIRM_MS;
      return this.view(reading, reading.holdRatio);
    }

    return this.view(reading, reading.holdRatio);
  }

  /** Manual trigger. Takes the current frame regardless of any threshold. */
  async captureManually(sample: DetectorSample | null): Promise<void> {
    const spec = this.currentSpec;
    if (!spec || this.phase !== "measure") return;

    if (sample) {
      const drive = this.detector?.bestDrive ?? 0;
      await this.storeBest(spec, sample, Math.max(drive, 0), true);
    }
    const result = this.ensure(spec);
    result.capturedManually = true;
    this.phase = "confirm";
    this.phaseUntil = performance.now() + CONFIRM_MS;
  }

  /** Skips the current position without capturing. */
  skip(): void {
    const spec = this.currentSpec;
    if (!spec) return;
    this.ensure(spec).timedOut = true;
    this.advance();
  }

  /**
   * Queues an already captured position for a retry.
   *
   * The existing still stays until the new attempt delivers one - otherwise a
   * failed retry costs a capture that had already succeeded.
   */
  redo(id: PositionId): void {
    const at = this.order.findIndex((s) => s.id === id);
    if (at < 0) return;
    const spec = this.order[at]!;
    const previous = this.results.get(id) ?? blankResult(spec);
    this.results.set(id, {
      ...previous,
      driveSeries: [],
      triggered: false,
      capturedManually: false,
      timedOut: false,
    });
    this.storedToken.delete(id);
    this.index = at;
    this.enterPrepare();
  }

  async finish(): Promise<SessionResult> {
    const durationMs = this.recorder.elapsedMs;
    const recording = await this.recorder.stop();
    this.phase = "finished";
    return {
      recording,
      results: this.allResults,
      startedAt: this.startedAtIso,
      durationMs,
    };
  }

  abort(): void {
    this.recorder.discard();
    this.phase = "finished";
  }

  // ------------------------------------------------------------- internal

  private view(reading: DetectorReading | null, progress: number): SessionView {
    return {
      phase: this.phase,
      spec: this.currentSpec,
      progress: Math.min(1, Math.max(0, progress)),
      reading,
      positionNumber: this.index + 1,
      positionCount: this.order.length,
    };
  }

  private enterPrepare(): void {
    this.phase = "prepare";
    this.phaseUntil = performance.now() + PREPARE_MS;
    this.detector = null;
    const spec = this.currentSpec;
    if (spec) this.ensure(spec).attempts += 1;
  }

  private enterMeasure(): void {
    const spec = this.currentSpec;
    if (!spec) return;
    this.phase = "measure";
    this.phaseUntil = performance.now() + MAX_MEASURE_MS;
    const tuned = tunedSpec(spec);
    this.ensure(spec).thresholds = tuningOf(spec);
    this.detector = new PositionDetector(tuned);
  }

  /**
   * Applies changed thresholds to the running position.
   *
   * The detector carries its thresholds from construction, so it is rebuilt.
   * That resets the hold window, which is correct: frames counted under the
   * old threshold say nothing about the new one. Saved stills are untouched.
   */
  retuneCurrent(): void {
    const spec = this.currentSpec;
    if (!spec || this.phase !== "measure") return;
    this.ensure(spec).thresholds = tuningOf(spec);
    this.detector = new PositionDetector(tunedSpec(spec));
  }

  private advance(): void {
    const spec = this.currentSpec;
    if (spec && this.detector) {
      this.ensure(spec).driveSeries = [...this.detector.driveSeries];
    }
    this.detector = null;

    if (this.index + 1 >= this.order.length) {
      this.phase = "review";
      return;
    }
    this.index += 1;
    this.enterPrepare();
  }

  private ensure(spec: PositionSpec): PositionResult {
    let result = this.results.get(spec.id);
    if (!result) {
      result = blankResult(spec);
      this.results.set(spec.id, result);
    }
    return result;
  }

  private markTriggered(spec: PositionSpec): void {
    this.ensure(spec).triggered = true;
  }

  private markTimedOut(spec: PositionSpec): void {
    const result = this.ensure(spec);
    if (!result.triggered && !result.capturedManually) result.timedOut = true;
  }

  private async storeBest(
    spec: PositionSpec,
    sample: DetectorSample,
    drive: number,
    force = false,
  ): Promise<void> {
    const token = ++this.captureToken;
    this.capturing = true;
    try {
      const still = await captureStill(this.video, this.recorder.elapsedMs, this.options.still ?? {});
      // An older, superseded job must not overwrite anything.
      const stored = this.storedToken.get(spec.id) ?? -1;
      if (!force && token < stored) return;
      this.storedToken.set(spec.id, token);

      const result = this.ensure(spec);
      result.still = still;
      result.apex = {
        drive,
        atMs: still.atMs,
        blendshapes: sample.blendshapes,
        metrics: sample.metrics,
        pose: sample.pose,
        quality: sample.quality,
      };
    } catch (err) {
      console.error("Standbild fehlgeschlagen", err);
    } finally {
      this.capturing = false;
    }
  }
}

function blankResult(spec: PositionSpec): PositionResult {
  return {
    spec,
    still: null,
    apex: null,
    driveSeries: [],
    triggered: false,
    capturedManually: false,
    timedOut: false,
    attempts: 0,
    thresholds: tuningOf(spec),
  };
}
