/**
 * Video recording across the whole sequence.
 *
 * Safari reports `isTypeSupported() === true` for MIME types it then rejects
 * in `start()`. Hence a chain of candidates, each in try/catch.
 */

import { t } from "../i18n";

export interface RecorderOptions {
  /** Target bitrate. Drives the storage footprint directly. */
  videoBitsPerSecond?: number;
  /** Interval at which chunks arrive. */
  timesliceMs?: number;
  /** Container candidates in order of preference. Default: WebM first. */
  mimeCandidates?: readonly string[];
}

export interface Recording {
  blob: Blob;
  mimeType: string;
  /** Measured duration in milliseconds. */
  durationMs: number;
  bytes: number;
}

/** Candidates in descending order. MP4/H.264 is the Safari fallback. */
const MIME_CANDIDATES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4;codecs=avc1",
  "video/mp4",
] as const;

/**
 * MP4/H.264 zuerst - der Hardware-Encoder des Geraets.
 *
 * iOS beantwortet `isTypeSupported` fuer WebM seit 18.4 mit ja, kodiert VP9
 * aber in Software: eine Sitzung auf einem iPhone lief damit auf 6 statt 30
 * Bildern je Sekunde (gemessen 2026-08-30). Fuer Aufnahmen direkt vom
 * Kamerastrom zaehlt der Encoder-Pfad, nicht das Containerformat - Seiten
 * ohne eigene Zeichenkette waehlen deshalb diese Reihenfolge.
 */
export const MP4_FIRST_MIME_CANDIDATES = [
  "video/mp4;codecs=avc1",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
] as const;

export function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const candidate of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return null;
}

export function fileExtensionFor(mimeType: string): string {
  return mimeType.includes("mp4") ? "mp4" : "webm";
}

export class SequenceRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private mime = "";
  /** Wann pausiert wurde (0 = laeuft) und wieviel Pause sich summiert hat. */
  private pausedAt = 0;
  private pausedTotal = 0;

  constructor(
    private readonly stream: MediaStream,
    private readonly options: RecorderOptions = {},
  ) {}

  get isRecording(): boolean {
    return this.recorder?.state === "recording";
  }

  /**
   * Position auf der Videozeitachse - die Bezugsachse fuer alles, was spaeter
   * im Video gefunden werden soll.
   *
   * Pausen zaehlen bewusst nicht mit: `pause()` haelt die Aufzeichnung an, im
   * Video entsteht kein Loch, sondern ein Schnitt. Wuerde hier die Wanduhr
   * weiterlaufen, zeigten alle Zeitstempel nach der ersten Pause auf die
   * falsche Stelle.
   */
  get elapsedMs(): number {
    if (this.startedAt === 0) return 0;
    const now = this.pausedAt > 0 ? this.pausedAt : performance.now();
    return now - this.startedAt - this.pausedTotal;
  }

  get isPaused(): boolean {
    return this.recorder?.state === "paused";
  }

  /** Haelt die Aufzeichnung an. Die Zeitachse bleibt stehen. */
  pause(): void {
    if (this.recorder?.state !== "recording") return;
    this.recorder.pause();
    this.pausedAt = performance.now();
  }

  resume(): void {
    if (this.recorder?.state !== "paused") return;
    this.recorder.resume();
    if (this.pausedAt > 0) this.pausedTotal += performance.now() - this.pausedAt;
    this.pausedAt = 0;
  }

  get mimeType(): string {
    return this.mime;
  }

  /** Chunks received so far. Still zero a few seconds in means the browser
   *  is not encoding this stream - better to stop than to hand over an
   *  empty file at the end. Only meaningful for WebM: the MP4 muxers of
   *  Chromium and iOS ignore the timeslice and flush everything on stop
   *  (measured 2026-08-30), so zero proves nothing there. */
  get chunkCount(): number {
    return this.chunks.length;
  }

  start(): void {
    if (this.recorder) throw new Error(t("error.recorderRunning"));

    const {
      videoBitsPerSecond = 4_000_000,
      timesliceMs = 1000,
      mimeCandidates = MIME_CANDIDATES,
    } = this.options;
    if (typeof MediaRecorder === "undefined" || !mimeCandidates.some((m) => MediaRecorder.isTypeSupported(m)))
      throw new Error(t("error.recorderUnsupported"));

    // Walk the whole chain: isTypeSupported is not reliable on iOS, only
    // start() is - a candidate it accepts and then rejects falls through.
    let lastError: unknown = null;
    for (const mimeType of mimeCandidates) {
      if (!MediaRecorder.isTypeSupported(mimeType)) continue;
      try {
        const recorder = new MediaRecorder(this.stream, { mimeType, videoBitsPerSecond });
        recorder.addEventListener("dataavailable", (event) => {
          if (event.data.size > 0) this.chunks.push(event.data);
        });
        recorder.addEventListener("error", (event) => {
          console.error("MediaRecorder-Fehler", event);
        });
        recorder.start(timesliceMs);
        this.recorder = recorder;
        this.mime = mimeType;
        this.startedAt = performance.now();
        this.pausedAt = 0;
        this.pausedTotal = 0;
        return;
      } catch (err) {
        lastError = err;
      }
    }

    throw new Error(
      `${t("error.recorderStart")}${lastError instanceof Error ? `: ${lastError.message}` : ""}`,
    );
  }

  async stop(): Promise<Recording> {
    const recorder = this.recorder;
    if (!recorder) throw new Error(t("error.recorderIdle"));

    // Vor dem Messen fortsetzen: sonst bliebe die Achse in der Pause stehen.
    this.resume();
    const durationMs = this.elapsedMs;
    await new Promise<void>((resolve) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
      recorder.stop();
    });

    const blob = new Blob(this.chunks, { type: this.mime });
    this.recorder = null;
    this.chunks = [];

    return { blob, mimeType: this.mime, durationMs, bytes: blob.size };
  }

  /** Aborts and discards everything recorded. */
  discard(): void {
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    this.recorder = null;
    this.chunks = [];
  }
}
