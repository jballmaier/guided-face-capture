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

  constructor(
    private readonly stream: MediaStream,
    private readonly options: RecorderOptions = {},
  ) {}

  get isRecording(): boolean {
    return this.recorder?.state === "recording";
  }

  /** Time since recording started - the reference axis for all stills. */
  get elapsedMs(): number {
    return this.startedAt === 0 ? 0 : performance.now() - this.startedAt;
  }

  get mimeType(): string {
    return this.mime;
  }

  start(): void {
    if (this.recorder) throw new Error(t("error.recorderRunning"));

    const { videoBitsPerSecond = 4_000_000, timesliceMs = 1000 } = this.options;
    const preferred = pickMimeType();
    if (!preferred) throw new Error(t("error.recorderUnsupported"));

    // Walk the chain from the chosen candidate: isTypeSupported is not
    // reliable on iOS, only start() is.
    const startIndex = MIME_CANDIDATES.indexOf(preferred as (typeof MIME_CANDIDATES)[number]);
    const queue = MIME_CANDIDATES.slice(Math.max(0, startIndex));

    let lastError: unknown = null;
    for (const mimeType of queue) {
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
