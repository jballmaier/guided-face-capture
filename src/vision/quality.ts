import type { FrameQuality, Landmark } from "../types";
import { t } from "../i18n";
import { boundingBox, interocular } from "./geometry";

/**
 * Image quality of the face region.
 *
 * Measured on the face crop, not the whole frame: a blurred background or a
 * bright window behind the head must not skew the result.
 */

/** Edge length of the analysis crop. Small enough for 30 fps. */
const PATCH = 192;

/** Reused so no canvas is created 30 times a second. */
let patchCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
let patchCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

function context(): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D {
  if (patchCtx) return patchCtx;
  if (typeof OffscreenCanvas !== "undefined") {
    patchCanvas = new OffscreenCanvas(PATCH, PATCH);
    patchCtx = patchCanvas.getContext("2d", { willReadFrequently: true });
  } else {
    const c = document.createElement("canvas");
    c.width = PATCH;
    c.height = PATCH;
    patchCanvas = c;
    patchCtx = c.getContext("2d", { willReadFrequently: true });
  }
  if (!patchCtx) throw new Error(t("error.noQualityContext"));
  return patchCtx;
}

/** Variance of the Laplacian. High variance means strong edges, i.e. sharp. */
function laplacianVariance(gray: Float32Array, w: number, h: number): number {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      // 4-neighbour Laplacian: -4*centre + up + down + left + right
      const v = -4 * gray[i]! + gray[i - 1]! + gray[i + 1]! + gray[i - w]! + gray[i + w]!;
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Null when no usable face crop can be determined. */
export function measureQuality(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  landmarks: readonly Landmark[],
  /**
   * Width `interocularPx` refers to. Differs from `sourceWidth`: measurement
   * runs on a downscaled copy, the still is saved at full size.
   */
  referenceWidth: number = sourceWidth,
): FrameQuality | null {
  const box = boundingBox(landmarks);
  const io = interocular(landmarks);
  if (!box || !io || box.width <= 0 || box.height <= 0) return null;

  // Some margin so chin and forehead are not cut off.
  const pad = 0.08;
  const sx = Math.max(0, (box.x - box.width * pad) * sourceWidth);
  const sy = Math.max(0, (box.y - box.height * pad) * sourceHeight);
  const sw = Math.min(sourceWidth - sx, box.width * (1 + 2 * pad) * sourceWidth);
  const sh = Math.min(sourceHeight - sy, box.height * (1 + 2 * pad) * sourceHeight);
  if (sw <= 1 || sh <= 1) return null;

  const ctx = context();
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, PATCH, PATCH);
  const { data } = ctx.getImageData(0, 0, PATCH, PATCH);

  const gray = new Float32Array(PATCH * PATCH);
  let lumSum = 0;
  let clippedBright = 0;
  let clippedDark = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    // Rec. 601 luma.
    const g = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
    gray[p] = g;
    lumSum += g;
    if (g >= 250) clippedBright++;
    else if (g <= 5) clippedDark++;
  }

  const n = PATCH * PATCH;
  return {
    sharpness: laplacianVariance(gray, PATCH, PATCH),
    luminance: lumSum / n,
    clippingBright: clippedBright / n,
    clippingDark: clippedDark / n,
    interocular: io,
    interocularPx: io * referenceWidth,
    centerX: box.x + box.width / 2,
    centerY: box.y + box.height / 2,
    boxWidth: box.width,
    boxHeight: box.height,
  };
}

/** Calibration values, to be set on real devices and fixed here. */
export const QUALITY_THRESHOLDS = {
  /** Below this the image counts as blurred. */
  minSharpness: 120,
  /** Too dark or too bright to be usable. */
  minLuminance: 60,
  maxLuminance: 205,
  /**
   * Share of blown-out pixels in the face box. Crushed black pixels do not
   * count: headphones, hair and a dark room reach the box, and the dark room
   * is the screen-light scenario - gating on it blocked the intended setup.
   * A face that is itself too dark is caught by `minLuminance`.
   */
  maxClippingBright: 0.06,
  /**
   * Eye distance as a share of frame width - below this the head is too far.
   *
   * Not in pixels: the value was calibrated as 90 px at 1920 px width and would
   * silently loosen with a higher capture resolution.
   */
  minInterocular: 90 / 1920,
  /** Permitted offset of the face centre from the frame centre. */
  maxOffCenter: 0.12,
} as const;

export type QualityIssue =
  | "no-face"
  | "multiple-faces"
  | "too-far"
  | "off-center"
  | "too-dark"
  | "too-bright"
  | "overexposed"
  | "blurry"
  | "head-tilted";

/** The id doubles as the dictionary key (`issue.<id>`). */
export function issueText(issue: QualityIssue): string {
  return t(`issue.${issue}`);
}

export function qualityIssues(
  q: FrameQuality,
  t: typeof QUALITY_THRESHOLDS = QUALITY_THRESHOLDS,
): QualityIssue[] {
  const issues: QualityIssue[] = [];
  if (q.interocular < t.minInterocular) issues.push("too-far");
  if (
    Math.abs(q.centerX - 0.5) > t.maxOffCenter ||
    Math.abs(q.centerY - 0.5) > t.maxOffCenter
  ) {
    issues.push("off-center");
  }
  if (q.luminance < t.minLuminance) issues.push("too-dark");
  else if (q.luminance > t.maxLuminance) issues.push("too-bright");
  if (q.clippingBright > t.maxClippingBright) issues.push("overexposed");
  if (q.sharpness < t.minSharpness) issues.push("blurry");
  return issues;
}
