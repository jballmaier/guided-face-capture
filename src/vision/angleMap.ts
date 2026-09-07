import type { Landmark } from "../types";
import { MESH_PAIRS, MIDLINE_FIT, PAIR_REGIONS, type PairRegion } from "./meshPairs";

/**
 * Winkelkarte der Gesichtsasymmetrie nach Heinrich et al.
 *
 * Heinrich A, Volk GF, Dobel C, Guntinas-Lichius O. AI-Based Angle Map
 * Analysis of Facial Asymmetry in Peripheral Facial Palsy. Bioengineering
 * 2026;13(4):426. Der Weg dort: 478 MediaPipe-Landmarks, Mittellinie per
 * Kleinste-Quadrate-Gerade durch 20 zentrale Punkte, Bild so gedreht, dass
 * die Mittellinie senkrecht steht, dann je Links-rechts-Paar der Winkel der
 * Verbindungslinie gegen die Horizontale. Score = Mittel der Betragswinkel.
 * Referenzfrei: kein Ruhebild noetig, jedes Bild steht fuer sich.
 *
 * Alles hier ist reine Rechnung auf Punktlisten - keine DOM-Abhaengigkeit,
 * damit es sich in Node gegenrechnen laesst. Gedreht werden die Punkte, nicht
 * das Bild: fuer die Winkel ist das dasselbe, und es kostet nichts.
 */

export interface Point {
  x: number;
  y: number;
}

/** Welche Paare in den Score eingehen. */
export type PairSet = "all" | "regional";

export interface AngleScores {
  /** Alle 225 Paare. */
  all: number;
  /** Augen, Nase und Mund zusammen - die Gegenden, in denen die
   *  informativen Paare des Papers liegen. */
  regional: number;
  eyes: number;
  nose: number;
  mouth: number;
  other: number;
}

export interface AngleAnalysis {
  /** Korrekturdrehung in Grad, die die Mittellinie senkrecht stellt - im
   *  Uhrzeigersinn positiv (y nach unten). Eine zur Bildrechten geneigte
   *  Stirn ergibt also negative Werte. */
  midlineTiltDeg: number;
  /** Alle Landmarks nach der Ausrichtung, in Pixeln des analysierten Bildes. */
  aligned: readonly Point[];
  /** Winkel je Paar in Grad, normalisiert auf (-90, 90]; positiv, wenn der
   *  linke Punkt (Seite der Person) tiefer liegt als der rechte. */
  angles: readonly number[];
  scores: AngleScores;
  /** Paare je Region - fuer Anzeige und Manifest. */
  counts: Readonly<Record<PairRegion, number>>;
}

/** Obergrenze der Farbskala: ab hier ist alles rot (Paper: >= 5 Grad). */
export const ANGLE_MAP_MAX_DEG = 5;

export const PAIR_COUNT = MESH_PAIRS.length;

/** Paarindizes je Region, einmal gebaut. */
const REGION_INDEX: Readonly<Record<PairRegion, readonly number[]>> = (() => {
  const out: Record<PairRegion, number[]> = { eyes: [], nose: [], mouth: [], other: [] };
  PAIR_REGIONS.forEach((region, i) => out[region].push(i));
  return out;
})();

const REGIONAL_INDEX: readonly number[] = [
  ...REGION_INDEX.eyes,
  ...REGION_INDEX.nose,
  ...REGION_INDEX.mouth,
].sort((a, b) => a - b);

/** Paarindizes eines Satzes. */
export function pairIndicesFor(set: PairSet): readonly number[] {
  return set === "all" ? MESH_PAIRS.map((_, i) => i) : REGIONAL_INDEX;
}

export function pairRegionCounts(): Readonly<Record<PairRegion, number>> {
  return {
    eyes: REGION_INDEX.eyes.length,
    nose: REGION_INDEX.nose.length,
    mouth: REGION_INDEX.mouth.length,
    other: REGION_INDEX.other.length,
  };
}

/** Normierte Landmarks in Bildpixel - die Winkel brauchen das Seitenverhaeltnis. */
export function toPixels(landmarks: readonly Landmark[], width: number, height: number): Point[] {
  return landmarks.map((l) => ({ x: l.x * width, y: l.y * height }));
}

/**
 * Neigung der Mittellinie in Radiant.
 *
 * Kleinste Quadrate von x ueber y, nicht umgekehrt: die Achse steht fast
 * senkrecht, und eine Regression von y auf x waere dort schlecht gestellt.
 * Rueckgabe ist der Winkel der Achse gegen die Vertikale.
 */
export function fitMidlineTilt(points: readonly Point[]): number {
  let sx = 0;
  let sy = 0;
  for (const i of MIDLINE_FIT) {
    sx += points[i]!.x;
    sy += points[i]!.y;
  }
  const n = MIDLINE_FIT.length;
  const mx = sx / n;
  const my = sy / n;
  let cov = 0;
  let varY = 0;
  for (const i of MIDLINE_FIT) {
    const dx = points[i]!.x - mx;
    const dy = points[i]!.y - my;
    cov += dx * dy;
    varY += dy * dy;
  }
  return varY > 0 ? Math.atan(cov / varY) : 0;
}

/** Schwerpunkt der Achsenpunkte - um ihn wird gedreht. */
export function midlineCenter(points: readonly Point[]): Point {
  let sx = 0;
  let sy = 0;
  for (const i of MIDLINE_FIT) {
    sx += points[i]!.x;
    sy += points[i]!.y;
  }
  return { x: sx / MIDLINE_FIT.length, y: sy / MIDLINE_FIT.length };
}

/** Dreht alle Punkte um `center`, so dass eine Achse mit Neigung `tilt` senkrecht steht. */
export function alignPoints(points: readonly Point[], tilt: number, center: Point): Point[] {
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  return points.map((p) => {
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    return { x: center.x + dx * c - dy * s, y: center.y + dx * s + dy * c };
  });
}

/** Winkel in (-90, 90] - eine Linie hat keine Richtung. */
function foldAngle(deg: number): number {
  let a = deg;
  while (a > 90) a -= 180;
  while (a <= -90) a += 180;
  return a;
}

/**
 * Winkel jeder Paarlinie gegen die Horizontale, in Grad.
 *
 * Gerechnet vom rechten zum linken Punkt der Person; bei y nach unten heisst
 * positiv, dass der linke Punkt tiefer sitzt.
 */
export function pairAngles(aligned: readonly Point[]): number[] {
  return MESH_PAIRS.map(([left, right]) => {
    const l = aligned[left]!;
    const r = aligned[right]!;
    return foldAngle((Math.atan2(l.y - r.y, l.x - r.x) * 180) / Math.PI);
  });
}

/** Mittel der Betragswinkel ueber eine Paarauswahl. */
export function meanAbsAngle(angles: readonly number[], indices: readonly number[]): number {
  if (indices.length === 0) return 0;
  let sum = 0;
  for (const i of indices) sum += Math.abs(angles[i]!);
  return sum / indices.length;
}

export function scoreAngles(angles: readonly number[]): AngleScores {
  return {
    all: meanAbsAngle(angles, pairIndicesFor("all")),
    regional: meanAbsAngle(angles, REGIONAL_INDEX),
    eyes: meanAbsAngle(angles, REGION_INDEX.eyes),
    nose: meanAbsAngle(angles, REGION_INDEX.nose),
    mouth: meanAbsAngle(angles, REGION_INDEX.mouth),
    other: meanAbsAngle(angles, REGION_INDEX.other),
  };
}

/** Die ganze Kette fuer ein Gesicht: Pixel, Achse, Drehung, Winkel, Score. */
export function analyzeFace(landmarks: readonly Landmark[], width: number, height: number): AngleAnalysis {
  const points = toPixels(landmarks, width, height);
  const tilt = fitMidlineTilt(points);
  const aligned = alignPoints(points, tilt, midlineCenter(points));
  const angles = pairAngles(aligned);
  return {
    midlineTiltDeg: (tilt * 180) / Math.PI,
    aligned,
    angles,
    scores: scoreAngles(angles),
    counts: pairRegionCounts(),
  };
}
