import { POSITIONS, type PositionId, type PositionSpec } from "./positions";
import { t } from "../i18n";

/**
 * Runtime overrides for the trigger thresholds.
 *
 * These values overlay `positions.ts` for this device; the code stays the
 * source, and `tuningAsCode()` is the way back.
 *
 * Changed thresholds go into the manifest: a capture with altered limits is
 * not a protocol-conforming capture.
 *
 * Without browser storage the values from the code apply. Not an error.
 */

export interface PositionTuning {
  minDrive: number;
  maxSuppress: number;
  holdMs: number;
}

export type TuningKey = keyof PositionTuning;

/** Input limits. `minDrive` above 1 is unreachable, `holdMs` of 0 would let
 *  a single outlier trigger. */
export const TUNING_LIMITS: Record<TuningKey, { min: number; max: number; step: number }> = {
  minDrive: { min: 0, max: 1, step: 0.05 },
  maxSuppress: { min: 0, max: 1, step: 0.05 },
  holdMs: { min: 100, max: 5000, step: 100 },
};

const STORAGE_KEY = "guided-face-capture.tuning.v1";

const overrides = new Map<PositionId, Partial<PositionTuning>>();

function clamp(key: TuningKey, value: number): number {
  const { min, max } = TUNING_LIMITS[key];
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Values from the code - the baseline "changed" is measured against. */
export function baseTuning(spec: PositionSpec): PositionTuning {
  return { minDrive: spec.minDrive, maxSuppress: spec.maxSuppress, holdMs: spec.holdMs };
}

/** Effective values: code, overlaid with what was set. */
export function tuningOf(spec: PositionSpec): PositionTuning {
  return { ...baseTuning(spec), ...(overrides.get(spec.id) ?? {}) };
}

/** Spec carrying the effective values - what the detector runs on. */
export function tunedSpec(spec: PositionSpec): PositionSpec {
  const patch = overrides.get(spec.id);
  return patch ? { ...spec, ...patch } : spec;
}

export function isTuned(spec: PositionSpec): boolean {
  const patch = overrides.get(spec.id);
  if (!patch) return false;
  const base = baseTuning(spec);
  return (Object.keys(patch) as TuningKey[]).some((k) => patch[k] !== base[k]);
}

export function anyTuned(): boolean {
  return POSITIONS.some(isTuned);
}

export function setTuning(spec: PositionSpec, key: TuningKey, value: number): void {
  const patch = { ...(overrides.get(spec.id) ?? {}) };
  const next = clamp(key, value);
  if (next === baseTuning(spec)[key]) delete patch[key];
  else patch[key] = next;

  if (Object.keys(patch).length === 0) overrides.delete(spec.id);
  else overrides.set(spec.id, patch);
  save();
}

export function resetTuning(spec?: PositionSpec): void {
  if (spec) overrides.delete(spec.id);
  else overrides.clear();
  save();
}

/** The changed values as source text, to be moved into `positions.ts`. */
export function tuningAsCode(): string {
  const lines = POSITIONS.filter(isTuned).map((spec) => {
    const t = tuningOf(spec);
    return `  ${spec.id}: minDrive ${t.minDrive}, maxSuppress ${t.maxSuppress}, holdMs ${t.holdMs}`;
  });
  if (lines.length === 0) return t("tuning.codeNone");
  return [
    `// ${t("tuning.codeHeader")}`,
    `// ${t("tuning.codeDevice", { agent: navigator.userAgent })}`,
    `// ${t("tuning.codeTime", { time: new Date().toISOString() })}`,
    ...lines,
  ].join("\n");
}

/** For the manifest: before and after, per changed position. */
export function tuningReport(): Record<string, { from: PositionTuning; to: PositionTuning }> {
  const out: Record<string, { from: PositionTuning; to: PositionTuning }> = {};
  for (const spec of POSITIONS) {
    if (isTuned(spec)) out[spec.id] = { from: baseTuning(spec), to: tuningOf(spec) };
  }
  return out;
}

function save(): void {
  try {
    const plain: Record<string, Partial<PositionTuning>> = {};
    for (const [id, patch] of overrides) plain[id] = patch;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plain));
  } catch {
    // No storage: the session keeps the values in memory.
  }
}

function load(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const plain = JSON.parse(raw) as Record<string, Partial<PositionTuning>>;
    for (const spec of POSITIONS) {
      const patch = plain[spec.id];
      if (!patch) continue;
      const clean: Partial<PositionTuning> = {};
      for (const key of Object.keys(TUNING_LIMITS) as TuningKey[]) {
        const value = patch[key];
        if (typeof value === "number") clean[key] = clamp(key, value);
      }
      if (Object.keys(clean).length > 0) overrides.set(spec.id, clean);
    }
  } catch {
    // Corrupt entry: discard rather than hang the application on it.
  }
}

load();
