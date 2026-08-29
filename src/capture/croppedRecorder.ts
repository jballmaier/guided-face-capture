import { startFrameLoop } from "./camera";
import { SequenceRecorder, type Recording } from "./recorder";
import type { CropRect, FrameSize } from "./cropRect";

/**
 * Aufnahme eines Bildausschnitts.
 *
 * Draws the crop into a canvas and records that canvas instead of the camera
 * stream. Two things fall out of it: the file shrinks with the area, and the
 * preview shows exactly what is recorded.
 *
 * One instance records many clips. `start()` and `stop()` may alternate as
 * often as needed; each clip gets a fresh recorder and therefore its own
 * timeline starting at zero. The canvas, the drawing loop and the capture
 * stream are set up once and outlive the individual clips - the preview keeps
 * running between them, which is what lets somebody get ready for the next
 * position.
 */

export interface CroppedRecorderOptions {
  fps?: number;
  videoBitsPerSecond?: number;
}

export interface CroppedRecording {
  recording: Recording;
  rect: CropRect;
  source: FrameSize;
  output: FrameSize;
  /** Tatsaechlich gezeichnete Bilder. Gegen Dauer mal Bildrate gehalten zeigt
   *  sich ein Einbruch, den die Datei selbst nicht verraet. */
  drawnFrames: number;
  /** Aufrufe der Bildschleife waehrend der Aufnahme, vor dem Ratendeckel.
   *  Gegen `drawnFrames` gehalten trennt sich eine langsam liefernde Kamera
   *  von einem zu scharf gesetzten Deckel. */
  sourceFrames: number;
  /** `elapsedMs` beim ersten gezeichneten Bild nach `start()` - untere
   *  Schranke fuer den Versatz zwischen Seitenuhr und erstem kodierten Bild. */
  firstFrameAtMs: number;
}

export class CroppedRecorder {
  private readonly surface = document.createElement("canvas");
  private readonly ctx: CanvasRenderingContext2D;
  private readonly fps: number;
  /** Einmal geholt und wiederverwendet: je `start()` einen neuen Strom zu
   *  ziehen liesse mit jedem Clip einen weiteren Track auf derselben Canvas
   *  zurueck, den niemand mehr stoppt. */
  private stream: MediaStream | null = null;
  private recorder: SequenceRecorder | null = null;
  private stopLoop: (() => void) | null = null;
  private drawn = 0;
  private sourceSeen = 0;
  private firstFrameAt = -1;
  private lastDrawAt = -Infinity;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly rect: CropRect,
    private readonly output: FrameSize,
    private readonly options: CroppedRecorderOptions = {},
  ) {
    this.fps = options.fps ?? 30;
    this.surface.width = output.width;
    this.surface.height = output.height;

    // Bewusst ohne `willReadFrequently`: das Flag erzwingt den Softwarepfad
    // und ist nur fuer die Analyse-Kopie richtig, die je Bild ausgelesen wird.
    const ctx = this.surface.getContext("2d", { alpha: false, desynchronized: true });
    if (!ctx) throw new Error("2D-Kontext fuer den Bildausschnitt nicht verfuegbar");
    this.ctx = ctx;
  }

  get canvas(): HTMLCanvasElement {
    return this.surface;
  }

  get elapsedMs(): number {
    return this.recorder?.elapsedMs ?? 0;
  }

  get isRecording(): boolean {
    return this.recorder?.isRecording ?? false;
  }

  get isPaused(): boolean {
    return this.recorder?.isPaused ?? false;
  }

  /** Bisher aufgezeichnete Bilder - gegen `elapsedMs` die tatsaechliche Rate. */
  get drawnFrames(): number {
    return this.drawn;
  }

  /**
   * Haelt die Aufzeichnung an. Die Zeichenschleife laeuft weiter - die Person
   * muss sich sehen koennen, um zurueck in den Rahmen zu finden.
   */
  pause(): void {
    this.recorder?.pause();
  }

  resume(): void {
    this.recorder?.resume();
  }

  /** Chunks, die der Recorder bisher bekommen hat. Nach zwei Sekunden noch
   *  null heisst, dass diese Kette auf dem Geraet nicht traegt. */
  get chunkCount(): number {
    return this.recorder?.chunkCount ?? 0;
  }

  /** Zeichnet ohne aufzuzeichnen - die Rahmenkontrolle vor dem Start. */
  startPreview(): void {
    if (this.stopLoop) return;
    this.stopLoop = startFrameLoop(this.video, (now) => this.draw(now));
  }

  start(): void {
    this.startPreview();
    // Mindestens ein Bild vor dem Start: Safari hat auf noch leeren
    // Canvas-Stroemen schon Ausgaben ohne Inhalt geliefert.
    this.draw(performance.now(), true);

    const bits = this.options.videoBitsPerSecond;
    this.stream ??= this.surface.captureStream(this.fps);
    this.recorder = new SequenceRecorder(
      this.stream,
      bits === undefined ? {} : { videoBitsPerSecond: bits },
    );
    this.drawn = 0;
    this.sourceSeen = 0;
    this.firstFrameAt = -1;
    this.recorder.start();
  }

  async stop(): Promise<CroppedRecording> {
    if (!this.recorder) throw new Error("Es laeuft keine Aufzeichnung");
    const recording = await this.recorder.stop();
    this.recorder = null;
    return {
      recording,
      rect: this.rect,
      source: { width: this.video.videoWidth, height: this.video.videoHeight },
      output: this.output,
      drawnFrames: this.drawn,
      sourceFrames: this.sourceSeen,
      firstFrameAtMs: this.firstFrameAt < 0 ? 0 : this.firstFrameAt,
    };
  }

  /** Beendet die Sitzung: Aufzeichnung, Zeichenschleife und Strom. */
  discard(): void {
    this.recorder?.discard();
    this.recorder = null;
    this.stopLoop?.();
    this.stopLoop = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  private draw(nowMs: number, force = false): void {
    const rec =
      this.recorder?.isRecording === true && !this.recorder.isPaused ? this.recorder : null;
    // Vor dem Deckel zaehlen. Was die Schleife angeboten bekommt und was
    // davon uebrig bleibt, sind zwei verschiedene Fragen - und nur beide
    // zusammen sagen, wo eine zu niedrige Rate herkommt.
    if (rec) this.sourceSeen += 1;

    // Bildrate deckeln - mit Spielraum. Greift nur, wenn die Quelle deutlich
    // schneller liefert als aufgezeichnet wird (60 gegen 30): neunzig Prozent
    // des Zielabstands lassen die gleiche Rate durch und halbieren die
    // doppelte weiterhin.
    const minGap = (1000 / this.fps) * 0.9;
    if (!force && nowMs - this.lastDrawAt < minGap) return;
    if (this.video.videoWidth === 0) return;
    this.lastDrawAt = nowMs;

    const sw = this.video.videoWidth;
    const sh = this.video.videoHeight;
    this.ctx.drawImage(
      this.video,
      this.rect.x * sw,
      this.rect.y * sh,
      this.rect.w * sw,
      this.rect.h * sh,
      0,
      0,
      this.output.width,
      this.output.height,
    );

    if (rec) {
      this.drawn += 1;
      if (this.firstFrameAt < 0) this.firstFrameAt = rec.elapsedMs;
    }
  }
}
