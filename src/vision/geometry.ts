import type { Landmark } from "../types";

/**
 * Distances from the 478 landmarks, normalised to interocular distance and
 * therefore independent of resolution and camera distance.
 *
 * Runs alongside the blendshapes: where a distinction is a distance (mouth
 * open or closed, eyelid gap), the measured distance beats the estimated
 * expression score, which is trained on unimpaired faces.
 */

/** Indices in the canonical MediaPipe face mesh (478 points, incl. iris). */
export const LM = {
  /** Iris centres. */
  irisRight: 468,
  irisLeft: 473,
  /** Eyelids, upper and lower, at the centre. */
  eyeRightUpper: 159,
  eyeRightLower: 145,
  eyeLeftUpper: 386,
  eyeLeftLower: 374,
  /** Eye corners. */
  eyeRightOuter: 33,
  eyeRightInner: 133,
  eyeLeftInner: 362,
  eyeLeftOuter: 263,
  /** Mouth corners. */
  mouthRight: 61,
  mouthLeft: 291,
  /** Inner lip edges; the gap between them shows teeth. */
  lipUpperInner: 13,
  lipLowerInner: 14,
  /** Outer lip edges. */
  lipUpperOuter: 0,
  lipLowerOuter: 17,
  /** Nose tip and bridge. */
  noseTip: 1,
  noseBridge: 168,
  /** Outer face contour at cheek height (face-oval points). */
  cheekOuterRight: 132,
  cheekOuterLeft: 361,
} as const;

function dist(a: Landmark, b: Landmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function at(lms: readonly Landmark[], index: number): Landmark | null {
  return lms[index] ?? null;
}

/** Interocular distance, falling back to the outer eye corners. */
export function interocular(lms: readonly Landmark[]): number | null {
  const a = at(lms, LM.irisRight);
  const b = at(lms, LM.irisLeft);
  if (a && b) return dist(a, b);
  const c = at(lms, LM.eyeRightOuter);
  const d = at(lms, LM.eyeLeftOuter);
  return c && d ? dist(c, d) : null;
}

/** Per-side measures. The side difference is the result, never a condition. */
export interface FaceMetrics {
  /** Eyelid gap height, per image side. */
  eyeOpeningRight: number;
  eyeOpeningLeft: number;
  /** Inner lip gap; > 0 means the mouth is open. */
  interlabialGap: number;
  /** Mouth width. */
  mouthWidth: number;
  /**
   * Philtrum to mouth corner, per side.
   *
   * The only per-side signal available for lip pursing: `mouthPucker` and
   * `mouthFunnel` are unpaired blendshapes.
   */
  philtrumToCornerRight: number;
  philtrumToCornerLeft: number;
  /**
   * Bridge-to-tip nose length. Nose wrinkling shortens it - the geometric
   * fallback where `noseSneer` stays silent. Only meaningful relative to the
   * same face at rest; absolute values vary too much between faces.
   */
  noseLength: number;
  /** Outer contour width at cheek height. Puffed cheeks widen it - same
   *  caveat: relative to rest, never absolute. */
  cheekWidth: number;
  /** Interocular distance, normalised units. */
  interocular: number;
}

export function faceMetrics(lms: readonly Landmark[]): FaceMetrics | null {
  const io = interocular(lms);
  if (!io || io <= 0) return null;

  const eyeRU = at(lms, LM.eyeRightUpper);
  const eyeRL = at(lms, LM.eyeRightLower);
  const eyeLU = at(lms, LM.eyeLeftUpper);
  const eyeLL = at(lms, LM.eyeLeftLower);
  const lipU = at(lms, LM.lipUpperInner);
  const lipL = at(lms, LM.lipLowerInner);
  const mR = at(lms, LM.mouthRight);
  const mL = at(lms, LM.mouthLeft);

  const philtrum = at(lms, LM.lipUpperOuter);
  const noseB = at(lms, LM.noseBridge);
  const noseT = at(lms, LM.noseTip);
  const cheekR = at(lms, LM.cheekOuterRight);
  const cheekL = at(lms, LM.cheekOuterLeft);

  if (
    !eyeRU || !eyeRL || !eyeLU || !eyeLL || !lipU || !lipL || !mR || !mL ||
    !philtrum || !noseB || !noseT || !cheekR || !cheekL
  ) {
    return null;
  }

  return {
    eyeOpeningRight: dist(eyeRU, eyeRL) / io,
    eyeOpeningLeft: dist(eyeLU, eyeLL) / io,
    interlabialGap: dist(lipU, lipL) / io,
    mouthWidth: dist(mR, mL) / io,
    philtrumToCornerRight: dist(philtrum, mR) / io,
    philtrumToCornerLeft: dist(philtrum, mL) / io,
    noseLength: dist(noseB, noseT) / io,
    cheekWidth: dist(cheekR, cheekL) / io,
    interocular: io,
  };
}

/** Axis-aligned face bounding box in normalised coordinates. */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function boundingBox(lms: readonly Landmark[]): BoundingBox | null {
  if (lms.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of lms) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
