import type { Blendshapes, BlendshapePair } from "../types";
import { t, tIn, type Locale, type TranslationKey } from "../i18n";
import type { FaceMetrics } from "../vision/geometry";

/**
 * Mechanics of the twelve positions: signals, thresholds, order. Everything
 * visible lives in `src/i18n/`.
 *
 * `index` sets both the order of guidance and the still filenames.
 *
 * Three rules hold throughout, because blendshapes are trained on unimpaired
 * faces and an affected side can stay near zero however hard someone tries:
 *
 *   1. Paired blendshapes enter as max(left, right), never as a mean. It is
 *      enough that the moving side performs the task.
 *   2. The side difference is measured and recorded, never used as a
 *      condition. It is the result, not the entry criterion.
 *   3. There is always a manual path. The automatic trigger is convenience.
 *
 * Same for geometry: eye closure counts the *smaller* of the two eyelid gaps,
 * i.e. the eye that closes best. A condition over both eyes can be
 * unattainable.
 *
 * First device run 2026-08-28: `noseSneer` and `cheekPuff` did not respond to
 * real movements - both positions now combine blendshapes with geometry
 * relative to the rest baseline. Thresholds for bared teeth and natural smile
 * remain unchecked.
 */

export type PositionId =
  | "neutral"
  | "forehead_wrinkle"
  | "eye_closure_gentle"
  | "eye_closure_forced"
  | "nose_wrinkle"
  | "smile_closed"
  | "smile_teeth"
  | "lip_pucker"
  | "cheek_puff"
  | "teeth_bared"
  | "mouth_corners_down"
  | "smile_natural";

/** Geometric channels, normalised to interocular distance. */
export type GeomMetric =
  | "interlabialGap"
  | "mouthWidth"
  | "eyeOpeningMin"
  | "eyeOpeningMax"
  | "noseLength"
  | "cheekWidth";

/**
 * Expression tree yielding a value between 0 and 1. `pair` implements
 * max(left, right) and is the default for anything two-sided.
 *
 * `geomRel` ramps over current/rest ratio instead of the absolute value -
 * for measures that vary too much between faces for a fixed threshold (nose
 * length, cheek width). Without a rest baseline it reads 0 and leaves the
 * other channels of an `anyOf` to carry the position.
 */
export type Signal =
  | { kind: "pair"; left: string; right: string }
  | { kind: "blend"; name: string }
  | { kind: "geom"; metric: GeomMetric; lo: number; hi: number }
  | { kind: "geomRel"; metric: GeomMetric; lo: number; hi: number }
  | { kind: "max"; of: Signal[] }
  | { kind: "min"; of: Signal[] }
  | { kind: "not"; of: Signal };

export interface PositionSpec {
  id: PositionId;
  /** 1..12, the order of the sequence. */
  index: number;
  /**
   * Label and instruction live in `src/i18n/` under `position.<id>.label` and
   * `position.<id>.instruction`, reached via `positionLabel()`.
   */
  /** Driving measure of the movement. */
  drive: Signal;
  /** Must stay low, otherwise it is a different position. */
  suppress?: Signal;
  /** From here the movement counts as performed. */
  minDrive: number;
  /** How far `suppress` may rise. */
  maxSuppress: number;
  /** How long the condition must hold within the window. */
  holdMs: number;
}

const pair = (left: string, right: string): Signal => ({ kind: "pair", left, right });
const blend = (name: string): Signal => ({ kind: "blend", name });
const geom = (metric: GeomMetric, lo: number, hi: number): Signal => ({ kind: "geom", metric, lo, hi });
const geomRel = (metric: GeomMetric, lo: number, hi: number): Signal => ({ kind: "geomRel", metric, lo, hi });
const anyOf = (...of: Signal[]): Signal => ({ kind: "max", of });
const allOf = (...of: Signal[]): Signal => ({ kind: "min", of });

/** Eye closure via both channels: estimated score or measured gap, whichever is higher. */
const EYE_CLOSED = anyOf(
  pair("eyeBlinkLeft", "eyeBlinkRight"),
  geom("eyeOpeningMin", 0.16, 0.05), // lo > hi: a small gap gives a high value
);

/** Squeezing - what separates gentle from forced eye closure. */
const EYE_SQUEEZE = anyOf(pair("eyeSquintLeft", "eyeSquintRight"), pair("browDownLeft", "browDownRight"));

/** Visible teeth means the lips are apart. */
const LIPS_PARTED = geom("interlabialGap", 0.04, 0.12);

/**
 * Lips pulled vertically off the teeth - what separates a broad smile from
 * baring the teeth, where upper and lower lip move apart instead of outwards.
 */
const LIPS_RETRACTED = anyOf(
  pair("mouthUpperUpLeft", "mouthUpperUpRight"),
  pair("mouthLowerDownLeft", "mouthLowerDownRight"),
);

/** Movements that must not occur at rest. Blinking is absent on purpose:
 *  it is physiological and is absorbed by the hold-window quota. */
const ANY_MOVEMENT = anyOf(
  blend("browInnerUp"),
  pair("browOuterUpLeft", "browOuterUpRight"),
  pair("browDownLeft", "browDownRight"),
  pair("noseSneerLeft", "noseSneerRight"),
  pair("mouthSmileLeft", "mouthSmileRight"),
  pair("mouthFrownLeft", "mouthFrownRight"),
  blend("mouthPucker"),
  blend("mouthFunnel"),
  blend("jawOpen"),
  blend("cheekPuff"),
);

/**
 * All thresholds are calibration values, to be checked on real devices. Until
 * then, err generous: a position that fails to trigger costs a second attempt,
 * a threshold set too strictly costs participation.
 *
 * For cheek puff, bared teeth and natural smile the signal choice itself is
 * an assumption - that `cheekPuff`, `mouthUpperUp*` and `mouthLowerDown*`
 * respond usefully has not been verified.
 */
export const POSITIONS: readonly PositionSpec[] = [
  {
    id: "neutral",
    index: 1,
    drive: { kind: "not", of: ANY_MOVEMENT },
    minDrive: 0.75,
    maxSuppress: 1,
    holdMs: 1500,
  },
  {
    id: "forehead_wrinkle",
    index: 2,
    drive: anyOf(blend("browInnerUp"), pair("browOuterUpLeft", "browOuterUpRight")),
    suppress: pair("browDownLeft", "browDownRight"),
    minDrive: 0.35,
    maxSuppress: 0.5,
    holdMs: 700,
  },
  {
    id: "eye_closure_gentle",
    index: 3,
    drive: EYE_CLOSED,
    suppress: EYE_SQUEEZE,
    minDrive: 0.5,
    maxSuppress: 0.55,
    holdMs: 700,
  },
  {
    id: "eye_closure_forced",
    index: 4,
    drive: allOf(EYE_CLOSED, EYE_SQUEEZE),
    minDrive: 0.4,
    maxSuppress: 1,
    holdMs: 700,
  },
  {
    id: "nose_wrinkle",
    index: 5,
    /**
     * `noseSneer` alone stayed below 0.15 through twelve seconds of real
     * attempts (measured 2026-08-28) - on that device the movement showed as
     * upper-lip raise (`mouthShrugUpper` 0.38, `mouthUpperUp*`) instead.
     * Those channels plus the shortening of the nose carry the position; the
     * ramp of the shortening is an uncalibrated assumption.
     */
    drive: anyOf(
      pair("noseSneerLeft", "noseSneerRight"),
      pair("mouthUpperUpLeft", "mouthUpperUpRight"),
      blend("mouthShrugUpper"),
      geomRel("noseLength", 0.97, 0.91),
    ),
    // The lip channels also fire on a broad smile - that is a different
    // position, not a wrinkled nose.
    suppress: pair("mouthSmileLeft", "mouthSmileRight"),
    minDrive: 0.25,
    maxSuppress: 0.5,
    holdMs: 700,
  },
  {
    id: "smile_closed",
    index: 6,
    drive: pair("mouthSmileLeft", "mouthSmileRight"),
    suppress: anyOf(LIPS_PARTED, blend("jawOpen")),
    minDrive: 0.35,
    maxSuppress: 0.45,
    holdMs: 700,
  },
  {
    id: "smile_teeth",
    index: 7,
    drive: allOf(pair("mouthSmileLeft", "mouthSmileRight"), LIPS_PARTED),
    minDrive: 0.3,
    maxSuppress: 1,
    holdMs: 700,
  },
  {
    id: "lip_pucker",
    index: 8,
    drive: anyOf(blend("mouthPucker"), blend("mouthFunnel")),
    suppress: pair("mouthSmileLeft", "mouthSmileRight"),
    minDrive: 0.35,
    maxSuppress: 0.4,
    holdMs: 700,
  },
  {
    id: "cheek_puff",
    index: 9,
    /**
     * `cheekPuff` read zero on a genuinely puffed face (measured 2026-08-28,
     * manual capture) - what did move was the geometry: cheek contour wider,
     * mouth 5 % narrower. Both enter relative to rest; the ramps are
     * uncalibrated assumptions.
     */
    drive: anyOf(
      blend("cheekPuff"),
      geomRel("cheekWidth", 1.02, 1.06),
      geomRel("mouthWidth", 0.97, 0.93),
    ),
    // Pursing also narrows the mouth - suppressing it separates puff from
    // pucker where the geometry alone cannot.
    suppress: anyOf(LIPS_PARTED, blend("jawOpen"), blend("mouthPucker"), blend("mouthFunnel")),
    minDrive: 0.3,
    maxSuppress: 0.45,
    holdMs: 700,
  },
  {
    id: "teeth_bared",
    index: 10,
    drive: allOf(LIPS_RETRACTED, LIPS_PARTED),
    minDrive: 0.25,
    maxSuppress: 1,
    holdMs: 700,
  },
  {
    id: "mouth_corners_down",
    index: 11,
    drive: pair("mouthFrownLeft", "mouthFrownRight"),
    suppress: pair("mouthSmileLeft", "mouthSmileRight"),
    minDrive: 0.25,
    maxSuppress: 0.35,
    holdMs: 700,
  },
  {
    id: "smile_natural",
    index: 12,
    drive: pair("mouthSmileLeft", "mouthSmileRight"),
    minDrive: 0.3,
    maxSuppress: 1,
    holdMs: 700,
  },
];

export function positionById(id: PositionId): PositionSpec {
  const found = POSITIONS.find((p) => p.id === id);
  if (!found) throw new Error(`Unbekannte Position: ${id}`);
  return found;
}

/** Base filename in the export, e.g. "01_neutral". */
export function positionSlug(spec: PositionSpec): string {
  return `${String(spec.index).padStart(2, "0")}_${spec.id}`;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Maps a measurement onto 0..1. `lo > hi` inverts the direction. */
function ramp(value: number, lo: number, hi: number): number {
  if (lo === hi) return 0;
  return clamp01((value - lo) / (hi - lo));
}

function geomValue(metric: GeomMetric, m: FaceMetrics): number {
  switch (metric) {
    case "interlabialGap":
      return m.interlabialGap;
    case "mouthWidth":
      return m.mouthWidth;
    case "eyeOpeningMin":
      return Math.min(m.eyeOpeningRight, m.eyeOpeningLeft);
    case "eyeOpeningMax":
      return Math.max(m.eyeOpeningRight, m.eyeOpeningLeft);
    case "noseLength":
      return m.noseLength;
    case "cheekWidth":
      return m.cheekWidth;
  }
}

/**
 * Collects the paired blendshapes of a signal tree.
 *
 * The trigger uses max(left, right), but the difference between the sides is
 * the clinically interesting quantity - the panel shows it live.
 */
export function collectPairs(signal: Signal): BlendshapePair[] {
  const found: BlendshapePair[] = [];
  const seen = new Set<string>();

  const walk = (s: Signal): void => {
    switch (s.kind) {
      case "pair": {
        const key = `${s.left}|${s.right}`;
        if (!seen.has(key)) {
          seen.add(key);
          found.push({ left: s.left, right: s.right });
        }
        break;
      }
      case "max":
      case "min":
        for (const child of s.of) walk(child);
        break;
      case "not":
        walk(s.of);
        break;
      case "blend":
      case "geom":
      case "geomRel":
        break;
    }
  };

  walk(signal);
  return found;
}

/** Evaluates a signal tree against one frame. Result in 0..1. */
export function evaluateSignal(
  signal: Signal,
  bs: Blendshapes,
  m: FaceMetrics,
  rest: FaceMetrics | null = null,
): number {
  switch (signal.kind) {
    case "blend":
      return clamp01(bs[signal.name] ?? 0);
    case "pair":
      // Rule 1: the moving side decides.
      return clamp01(Math.max(bs[signal.left] ?? 0, bs[signal.right] ?? 0));
    case "geom":
      return ramp(geomValue(signal.metric, m), signal.lo, signal.hi);
    case "geomRel": {
      if (!rest) return 0;
      const base = geomValue(signal.metric, rest);
      if (base <= 0) return 0;
      return ramp(geomValue(signal.metric, m) / base, signal.lo, signal.hi);
    }
    case "max":
      return signal.of.reduce((acc, s) => Math.max(acc, evaluateSignal(s, bs, m, rest)), 0);
    case "min":
      return signal.of.reduce((acc, s) => Math.min(acc, evaluateSignal(s, bs, m, rest)), 1);
    case "not":
      return 1 - evaluateSignal(signal.of, bs, m, rest);
  }
}

/** Label in the display language. */
export function positionLabel(spec: PositionSpec): string {
  return t(`position.${spec.id}.label` as TranslationKey);
}

export function positionInstruction(spec: PositionSpec): string {
  return t(`position.${spec.id}.instruction` as TranslationKey);
}

/** Label in a fixed language - for anything that gets saved. */
export function positionLabelIn(locale: Locale, spec: PositionSpec): string {
  return tIn(locale, `position.${spec.id}.label` as TranslationKey);
}
