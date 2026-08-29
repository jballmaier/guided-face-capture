/**
 * Ausschnittrechteck fuer die Videoaufnahme.
 *
 * Pure arithmetic, no DOM. Unlike `export/crop.ts`, which cuts a still whose
 * face box was measured in that very frame, this rectangle is fixed *before*
 * the recording and has to survive twelve expressions and two minutes of head
 * movement with nothing tracking along. Hence the generous margin.
 */

/** Rechteck im Vollbild, normalisiert (0..1). x/y = obere linke Ecke. */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FaceBox {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

export interface FrameSize {
  width: number;
  height: number;
}

/**
 * Rand je Seite, als Anteil der Gesichtsbox.
 *
 * At a typical box of 20 % frame width this leaves room to shift the head by
 * its own width before anything is cut off.
 */
export const VIDEO_CROP_PAD = 0.6;

/** Breite zu Hoehe. Ein festes Verhaeltnis macht die spaetere Auswertung
 *  reproduzierbar, und die gepolsterte Box liegt ohnehin nahe 3:4. */
export const CROP_ASPECT = 3 / 4;

/** Lange Kante der Ausgabe. 0 behaelt die Aufloesung des Ausschnitts. */
export const CROP_MAX_EDGE = 1080;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function cropRectFor(
  box: FaceBox,
  frame: FrameSize,
  options: { pad?: number; aspect?: number } = {},
): CropRect {
  const { pad = VIDEO_CROP_PAD, aspect = CROP_ASPECT } = options;

  let w = box.width * (1 + 2 * pad);
  let h = box.height * (1 + 2 * pad);

  // Das Zielverhaeltnis gilt in Pixeln, nicht in normalisierten Einheiten:
  // x ist ein Anteil der Breite, y einer der Hoehe - sie sind nicht
  // vergleichbar, solange das Bild nicht quadratisch ist.
  const wPx = w * frame.width;
  const hPx = h * frame.height;
  if (wPx / hPx < aspect) w = (hPx * aspect) / frame.width;
  else h = wPx / aspect / frame.height;

  // Nie groesser als das Bild. Derselbe Faktor auf beide Kanten haelt das
  // Verhaeltnis - normalisiert wie in Pixeln.
  const shrink = Math.min(1, 1 / w, 1 / h);
  w *= shrink;
  h *= shrink;

  return {
    x: clamp(box.centerX - w / 2, 0, 1 - w),
    y: clamp(box.centerY - h / 2, 0, 1 - h),
    w,
    h,
  };
}

/** Ausgabegroesse. Gerade Kantenlaengen, weil H.264 sie verlangt. */
export function cropOutputSize(
  rect: CropRect,
  frame: FrameSize,
  maxEdge: number = CROP_MAX_EDGE,
): FrameSize {
  const srcW = rect.w * frame.width;
  const srcH = rect.h * frame.height;
  const scale = maxEdge > 0 ? Math.min(1, maxEdge / Math.max(srcW, srcH)) : 1;
  const even = (v: number): number => Math.max(2, Math.round((v * scale) / 2) * 2);
  return { width: even(srcW), height: even(srcH) };
}

/** Liegt die Box noch im Rechteck? Prueft die Box, nicht nur ihren Mittelpunkt. */
export function boxInsideRect(box: FaceBox, rect: CropRect): boolean {
  const left = box.centerX - box.width / 2;
  const right = box.centerX + box.width / 2;
  const top = box.centerY - box.height / 2;
  const bottom = box.centerY + box.height / 2;
  return left >= rect.x && right <= rect.x + rect.w && top >= rect.y && bottom <= rect.y + rect.h;
}
