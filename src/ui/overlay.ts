import type { Landmark } from "../types";
import type { PositionId } from "../protocol/positions";
import { regionConnections, tesselation, unionIndices, type RegionName } from "../vision/regions";

/**
 * Everything drawn onto the overlay canvas.
 *
 * Bewusst aus main.ts herausgezogen: Die Darstellung hat inzwischen drei
 * independent switches (mesh mode, anonymous view, screen light), and their
 * interplay belongs in one place rather than scattered through the
 * Frameschleife.
 */

export type MeshMode = "off" | "points" | "wire";

export interface OverlayInput {
  landmarks: readonly Landmark[] | null;
  meshMode: MeshMode;
  /** Regions belonging to the current position. */
  highlight: readonly RegionName[];
  /** Hide the video, show the point mesh only. */
  anonymous: boolean;
  /** Light theme, because the screen serves as the light source. */
  light: boolean;
  /** Zieloval zur Ausrichtung. */
  guide: boolean;
}

interface Palette {
  backdrop: string;
  base: string;
  wire: string;
  highlight: string;
  highlightLine: string;
  guide: string;
}

const DARK: Palette = {
  backdrop: "#0b0e13",
  base: "rgba(122, 160, 214, 0.55)",
  wire: "rgba(255, 255, 255, 0.09)",
  highlight: "#f0b429",
  highlightLine: "rgba(240, 180, 41, 0.85)",
  guide: "rgba(255, 255, 255, 0.25)",
};

const LIGHT: Palette = {
  backdrop: "#ffffff",
  base: "rgba(28, 62, 112, 0.6)",
  wire: "rgba(0, 0, 0, 0.10)",
  highlight: "#a8480a",
  highlightLine: "rgba(168, 72, 10, 0.85)",
  guide: "rgba(0, 0, 0, 0.28)",
};

/**
 * Welche Region zu welcher Position gehoert.
 *
 * Lives in the interface layer, the only one allowed to know both: the
 * protocol knows nothing about presentation, the view nothing about the
 * protocol.
 */
const HIGHLIGHT: Record<PositionId, RegionName[]> = {
  neutral: [],
  forehead_wrinkle: ["brows"],
  eye_closure_gentle: ["eyes"],
  eye_closure_forced: ["eyes", "brows"],
  nose_wrinkle: ["nose"],
  smile_closed: ["lips"],
  smile_teeth: ["lips"],
  lip_pucker: ["lips"],
  // There is no region set for the cheek; the face outline is the only line
  // on which puffing shows at all.
  cheek_puff: ["faceOval"],
  teeth_bared: ["lips"],
  mouth_corners_down: ["lips"],
  smile_natural: ["lips"],
};

export function highlightFor(id: PositionId | null): RegionName[] {
  return id ? (HIGHLIGHT[id] ?? []) : [];
}

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  input: OverlayInput,
): void {
  const palette = input.light ? LIGHT : DARK;
  ctx.clearRect(0, 0, width, height);

  // In anonymous view the canvas covers the video completely, and CSS hides
  // it as well - two independent paths, because a face showing through is the
  // one genuinely embarrassing failure here.
  if (input.anonymous) {
    ctx.fillStyle = palette.backdrop;
    ctx.fillRect(0, 0, width, height);
  }

  if (input.guide) {
    ctx.strokeStyle = palette.guide;
    ctx.lineWidth = Math.max(1, width / 500);
    ctx.beginPath();
    ctx.ellipse(width / 2, height / 2, width * 0.21, height * 0.33, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  const { landmarks } = input;
  if (!landmarks || input.meshMode === "off") return;

  const scale = Math.max(1, width / 640);
  const highlighted = input.highlight.length > 0 ? unionIndices(input.highlight) : null;

  if (input.meshMode === "wire") {
    ctx.strokeStyle = palette.wire;
    ctx.lineWidth = Math.max(0.5, scale * 0.5);
    ctx.beginPath();
    for (const c of tesselation()) {
      const a = landmarks[c.start];
      const b = landmarks[c.end];
      if (!a || !b) continue;
      ctx.moveTo(a.x * width, a.y * height);
      ctx.lineTo(b.x * width, b.y * height);
    }
    ctx.stroke();
  }

  // Grundpunkte
  const dot = Math.max(1, scale);
  ctx.fillStyle = palette.base;
  for (let i = 0; i < landmarks.length; i++) {
    if (highlighted?.has(i)) continue;
    const p = landmarks[i]!;
    ctx.fillRect(p.x * width - dot / 2, p.y * height - dot / 2, dot, dot);
  }

  if (!highlighted) return;

  // Highlighted region: outline first, points on top.
  ctx.strokeStyle = palette.highlightLine;
  ctx.lineWidth = Math.max(1, scale * 1.1);
  ctx.beginPath();
  for (const name of input.highlight) {
    for (const c of regionConnections(name)) {
      const a = landmarks[c.start];
      const b = landmarks[c.end];
      if (!a || !b) continue;
      ctx.moveTo(a.x * width, a.y * height);
      ctx.lineTo(b.x * width, b.y * height);
    }
  }
  ctx.stroke();

  const big = Math.max(2, scale * 2.4);
  ctx.fillStyle = palette.highlight;
  for (const i of highlighted) {
    const p = landmarks[i];
    if (!p) continue;
    ctx.fillRect(p.x * width - big / 2, p.y * height - big / 2, big, big);
  }
}
