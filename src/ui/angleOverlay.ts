import { MESH_PAIRS, MIDLINE_FIT } from "../vision/meshPairs";
import { ANGLE_MAP_MAX_DEG, type AngleAnalysis, type Point } from "../vision/angleMap";

/**
 * Zeichnet die Winkelkarte: eine Linie je Paar, gefaerbt nach dem Betrag des
 * Winkels - blau bei null Grad, rot ab der Obergrenze (Paper: fuenf Grad).
 * Ohne Foto gezeichnet ist die Karte das anonyme Ergebnisbild des Papers.
 */

const BLUE = [47, 106, 208] as const;
const RED = [212, 60, 40] as const;

export function angleColor(absDeg: number, alpha = 1): string {
  const t = Math.min(1, Math.max(0, absDeg / ANGLE_MAP_MAX_DEG));
  const r = Math.round(BLUE[0] + (RED[0] - BLUE[0]) * t);
  const g = Math.round(BLUE[1] + (RED[1] - BLUE[1]) * t);
  const b = Math.round(BLUE[2] + (RED[2] - BLUE[2]) * t);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export interface AngleMapStyle {
  lineWidth: number;
  pointRadius: number;
  alpha: number;
  /** Mittellinie einzeichnen (nur sinnvoll auf ausgerichteten Punkten). */
  midline: boolean;
}

/**
 * Linien zwischen den Paarpunkten in `points` (beliebiges Koordinatensystem
 * - live die rohen Landmarks auf dem Video, im Export die ausgerichteten).
 */
export function drawAngleMap(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  angles: readonly number[],
  pairIndices: readonly number[],
  style: AngleMapStyle,
): void {
  ctx.lineCap = "round";
  ctx.lineWidth = style.lineWidth;
  for (const i of pairIndices) {
    const [left, right] = MESH_PAIRS[i]!;
    const l = points[left]!;
    const r = points[right]!;
    ctx.strokeStyle = angleColor(Math.abs(angles[i]!), style.alpha);
    ctx.beginPath();
    ctx.moveTo(l.x, l.y);
    ctx.lineTo(r.x, r.y);
    ctx.stroke();
    if (style.pointRadius > 0) {
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.arc(l.x, l.y, style.pointRadius, 0, Math.PI * 2);
      ctx.arc(r.x, r.y, style.pointRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (style.midline) {
    const top = points[MIDLINE_FIT[MIDLINE_FIT.length - 1]!]!;
    ctx.strokeStyle = `rgba(127, 127, 127, ${style.alpha * 0.6})`;
    ctx.lineWidth = Math.max(1, style.lineWidth * 0.6);
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    let minY = Infinity;
    let maxY = -Infinity;
    let x = top.x;
    for (const i of MIDLINE_FIT) {
      minY = Math.min(minY, points[i]!.y);
      maxY = Math.max(maxY, points[i]!.y);
      x = points[i]!.x;
    }
    ctx.moveTo(x, minY);
    ctx.lineTo(x, maxY);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/**
 * Die Karte ohne Foto als eigenes Bild: ausgerichtete Punkte, auf `size`
 * Pixel Kante eingepasst, heller Grund. Das ist die Darstellung, die das
 * Paper zeigt - und die einzige, die ohne Personenbezug weitergegeben werden
 * kann.
 */
export function renderAngleMapImage(
  analysis: AngleAnalysis,
  pairIndices: readonly number[],
  size: number,
): HTMLCanvasElement {
  const pts = analysis.aligned;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const margin = 0.08;
  const span = Math.max(maxX - minX, maxY - minY) * (1 + 2 * margin);
  const scale = size / span;
  const offX = (size - (maxX - minX) * scale) / 2;
  const offY = (size - (maxY - minY) * scale) / 2;
  const mapped = pts.map((p) => ({ x: offX + (p.x - minX) * scale, y: offY + (p.y - minY) * scale }));

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D-Kontext fuer die Winkelkarte nicht verfuegbar");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  drawAngleMap(ctx, mapped, analysis.angles, pairIndices, {
    lineWidth: Math.max(1, size / 400),
    pointRadius: Math.max(1, size / 500),
    alpha: 0.9,
    midline: true,
  });
  return canvas;
}

/** Farbbalken fuer die Legende. */
export function drawColorScale(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  for (let x = 0; x < w; x++) {
    ctx.fillStyle = angleColor((x / (w - 1)) * ANGLE_MAP_MAX_DEG);
    ctx.fillRect(x, 0, 1, h);
  }
}
