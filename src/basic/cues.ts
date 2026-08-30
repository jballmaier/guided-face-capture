import { positionLabelIn, type PositionId, type PositionSpec } from "../protocol/positions";
import { tIn, type Locale, type TranslationKey } from "../i18n";
import type { Tone, Voice } from "./voice";

/**
 * Takt eines einzelnen Clips.
 *
 * Every position is recorded on its own, and the announcement runs *before*
 * the recording - it may take as long as the voice needs without ending up in
 * a file. What is left here is pure timing: a second of rest, the movement
 * three times for a second each, a second of rest.
 *
 * The lead does two jobs. It gives every clip its own rest reference, so a
 * position can be normalised against the same recording rather than against
 * another clip; and it absorbs the encoder's start-up, so the frames some
 * devices drop right after `start()` are missing from the rest, not from the
 * first hold.
 */

export type CueKind = "lead" | "hold" | "release" | "tail";

export interface CueStep {
  kind: CueKind;
  positionId: PositionId;
  index: number;
  /** 1..repCount, nur bei hold/release. */
  rep: number;
  repCount: number;
  plannedMs: number;
  tone: Tone | null;
}

export interface CueEvent {
  step: CueStep;
  /** Auf der Zeitachse dieses Clips - jeder Clip beginnt bei null. */
  startMs: number;
  endMs: number;
}

export const HOLD_MS = 1000;
export const RELEASE_MS = 1000;
export const LEAD_MS = 1000;
export const TAIL_MS = 1000;
/** Die Ruheposition wird einmal und laenger gehalten - Referenzstrecke. */
export const NEUTRAL_HOLD_MS = 3000;
export const REPETITIONS = 3;

const NEUTRAL_ID: PositionId = "neutral";

function instructionIn(locale: Locale, spec: PositionSpec): string {
  return tIn(locale, `position.${spec.id}.instruction` as TranslationKey);
}

/** Ruhe wird einmal gehalten, alles andere dreimal. */
export function repetitionsFor(spec: PositionSpec): number {
  return spec.id === NEUTRAL_ID ? 1 : REPETITIONS;
}

/** Takt eines Clips. Ohne Sprache - die Ansage lief vorher. */
export function buildPositionScript(spec: PositionSpec): CueStep[] {
  const single = spec.id === NEUTRAL_ID;
  const repCount = repetitionsFor(spec);
  const base = { positionId: spec.id, index: spec.index, repCount };

  const steps: CueStep[] = [
    { ...base, kind: "lead", rep: 0, plannedMs: LEAD_MS, tone: null },
  ];

  for (let rep = 1; rep <= repCount; rep++) {
    steps.push({
      ...base,
      kind: "hold",
      rep,
      plannedMs: single ? NEUTRAL_HOLD_MS : HOLD_MS,
      tone: "go",
    });
    // Kein Loslassen nach der Ruhe: es gibt nichts zurueckzunehmen, und die
    // Referenzstrecke soll nicht von einem Ton unterbrochen werden.
    if (!single) {
      steps.push({ ...base, kind: "release", rep, plannedMs: RELEASE_MS, tone: "release" });
    }
  }

  steps.push({ ...base, kind: "tail", rep: 0, plannedMs: TAIL_MS, tone: null });
  return steps;
}

/** Erwartete Dauer eines Clips - fuer Anzeige und Fortschritt. */
export function scriptDurationMs(steps: readonly CueStep[]): number {
  return steps.reduce((sum, s) => sum + s.plannedMs, 0);
}

export interface Announcement {
  text: string;
  /** Wurde das Wiederholungsmuster mitgesprochen? */
  sayPattern: boolean;
}

/**
 * Wie viel gesprochen wird.
 *
 * `verbose` sagt Name und Anleitung, `brief` nur den Namen - die Anleitung
 * steht ohnehin auf dem Bildschirm. `tones` laesst die Sprache ganz weg; die
 * Toene tragen den Takt allein, auch bei geschlossenen Augen. Die Wahl bleibt
 * gespeichert und steht im Manifest.
 */
export type AnnounceMode = "verbose" | "brief" | "tones";

const ANNOUNCE_STORAGE_KEY = "guided-face-capture.announce";

export function loadAnnounceMode(): AnnounceMode {
  try {
    const value = localStorage.getItem(ANNOUNCE_STORAGE_KEY);
    if (value === "verbose" || value === "brief" || value === "tones") return value;
  } catch {
    // Ohne Speicher gilt die Vorgabe.
  }
  return "verbose";
}

export function saveAnnounceMode(mode: AnnounceMode): void {
  try {
    localStorage.setItem(ANNOUNCE_STORAGE_KEY, mode);
  } catch {
    // Die Wahl gilt dann nur fuer diese Sitzung.
  }
}

/**
 * Was vor dem Clip gesagt wird.
 *
 * Getrennt vom Takt, weil es in keiner Datei landet. Das Muster "dreimal, je
 * eine Sekunde" gilt fuer die ganze Folge und wird deshalb einmal gesagt, nicht
 * zwoelfmal - der Aufrufer entscheidet wann, weil nur er weiss, ob es schon
 * gesagt wurde. Auch `brief` behaelt das Muster und den Halten-Hinweis der
 * Ruheposition: beides ist Taktwissen, keine Wiederholung des Bildschirms.
 */
export function announcementFor(
  spec: PositionSpec,
  locale: Locale,
  options: { sayPattern: boolean; brief?: boolean },
): Announcement {
  const single = spec.id === NEUTRAL_ID;
  const sayPattern = !single && options.sayPattern;

  let suffix = "";
  if (single) suffix = tIn(locale, "basic.announceHold");
  else if (sayPattern) suffix = tIn(locale, "basic.announceSuffix");

  const body = options.brief ? "" : ` ${instructionIn(locale, spec)}`;
  const text = `${positionLabelIn(locale, spec)}.${body}${suffix ? ` ${suffix}` : ""}`;
  return { text, sayPattern };
}

export interface CueRunnerDeps {
  voice: Voice;
  /** Zeitachse dieses Clips - `elapsedMs` des laufenden Recorders. */
  clock: () => number;
  onStep: (step: CueStep, at: number, total: number) => void;
}

/**
 * Spielt den Takt eines Clips ab und misst, was tatsaechlich passiert ist.
 *
 * Gemessen statt gerechnet: `plannedMs` sagt, was verlangt war, `startMs` und
 * `endMs`, was daraus wurde. Ein Geraet, das zurueckfaellt, ist damit im
 * Manifest zu sehen statt zu vermuten.
 */
export class CueRunner {
  private readonly collected: CueEvent[] = [];
  private aborted = false;
  private wake: (() => void) | null = null;

  constructor(
    private readonly steps: readonly CueStep[],
    private readonly deps: CueRunnerDeps,
  ) {}

  /** Auch nach `abort()` gefuellt - ein abgebrochener Clip bleibt lesbar. */
  get events(): readonly CueEvent[] {
    return this.collected;
  }

  get isAborted(): boolean {
    return this.aborted;
  }

  async run(): Promise<CueEvent[]> {
    for (let i = 0; i < this.steps.length; i++) {
      if (this.aborted) break;
      const step = this.steps[i]!;
      const startMs = this.deps.clock();
      this.deps.onStep(step, i, this.steps.length);

      if (step.tone) this.deps.voice.tone(step.tone);
      await this.delay(step.plannedMs);
      if (this.aborted) break;

      this.collected.push({ step, startMs, endMs: this.deps.clock() });
    }
    return this.collected;
  }

  abort(): void {
    this.aborted = true;
    this.wake?.();
  }

  private delay(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.wake = null;
        resolve();
      }, ms);
      // Ein Abbruch soll nicht erst am Ende der Wartezeit wirken.
      this.wake = () => {
        clearTimeout(timer);
        this.wake = null;
        resolve();
      };
    });
  }
}
