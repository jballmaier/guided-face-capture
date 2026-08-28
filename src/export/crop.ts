import type { PositionResult } from "../session/session";
import type { FrameQuality } from "../types";

/**
 * Measures what a face crop would have saved - without cropping anything.
 *
 * The open protocol question is client-side cropping. The saving is NOT the
 * cut-off area's share of pixels: JPEG stores an even background almost for
 * free, so the saving is whatever the background actually cost - and that
 * depends on the scene behind the person. Hence a measurement per export
 * instead of an estimate: every still is re-encoded cropped to the face box
 * plus margin, at the same quality, and both sizes go into the manifest. The
 * exported stills stay untouched.
 */

/**
 * Margin around the face box, per side, as a share of the box. Generous so
 * chin, forehead and ears stay in - a cut-off face is the one crop error that
 * damages the analysis.
 */
export const CROP_PAD = 0.35;

export interface CropEstimate {
  width: number;
  height: number;
  bytes: number;
  /** Crop area as a share of the full frame. */
  pixelShare: number;
  /** Crop bytes as a share of the full still. */
  byteShare: number;
}

export interface CropReport {
  pad: number;
  /** JPEG quality both encodings used. */
  quality: number;
  perPosition: Record<string, CropEstimate>;
  totals: { fullBytes: number; croppedBytes: number } | null;
}

let canvas: HTMLCanvasElement | null = null;

export async function estimateCropSavings(
  results: readonly PositionResult[],
  quality: number,
): Promise<CropReport> {
  const perPosition: Record<string, CropEstimate> = {};
  let fullBytes = 0;
  let croppedBytes = 0;

  for (const result of results) {
    const { still, apex } = result;
    if (!still || !apex) continue;
    try {
      const estimate = await encodeCropped(still.blob, apex.quality, quality);
      if (!estimate) continue;
      perPosition[result.spec.id] = estimate;
      fullBytes += still.blob.size;
      croppedBytes += estimate.bytes;
    } catch (err) {
      // A failed measurement must not fail the export.
      console.warn("Zuschnitt-Messung fehlgeschlagen", result.spec.id, err);
    }
  }

  return {
    pad: CROP_PAD,
    quality,
    perPosition,
    totals: fullBytes > 0 ? { fullBytes, croppedBytes } : null,
  };
}

async function encodeCropped(
  blob: Blob,
  q: FrameQuality,
  quality: number,
): Promise<CropEstimate | null> {
  const bitmap = await createImageBitmap(blob);
  try {
    const W = bitmap.width;
    const H = bitmap.height;

    // The face box was measured on the analysis copy; normalised coordinates
    // carry over to the full-size still unchanged.
    const w = Math.min(1, q.boxWidth * (1 + 2 * CROP_PAD));
    const h = Math.min(1, q.boxHeight * (1 + 2 * CROP_PAD));
    const x = Math.min(1 - w, Math.max(0, q.centerX - w / 2));
    const y = Math.min(1 - h, Math.max(0, q.centerY - h / 2));

    const sw = Math.max(1, Math.round(w * W));
    const sh = Math.max(1, Math.round(h * H));

    canvas ??= document.createElement("canvas");
    if (canvas.width !== sw || canvas.height !== sh) {
      canvas.width = sw;
      canvas.height = sh;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, Math.round(x * W), Math.round(y * H), sw, sh, 0, 0, sw, sh);

    const encoded = await new Promise<Blob | null>((resolve) =>
      (canvas as HTMLCanvasElement).toBlob(resolve, "image/jpeg", quality),
    );
    if (!encoded) return null;

    return {
      width: sw,
      height: sh,
      bytes: encoded.size,
      pixelShare: (sw * sh) / (W * H),
      byteShare: encoded.size / blob.size,
    };
  } finally {
    bitmap.close();
  }
}
