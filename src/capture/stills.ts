/**
 * Stills at native camera resolution.
 *
 * Drawn from the video element, not cut from the recording: a video codec
 * smooths exactly the edges that are measured later - eyelid gap, mouth
 * corners, nasolabial fold.
 *
 * MIRRORING. A getUserMedia stream is not mirrored; the preview mirrors via
 * CSS only, because otherwise every correcting movement feels inverted. That
 * mirroring must NOT reach the canvas: it would swap left and right, and with
 * them the side of the finding, invisibly.
 *
 * `mirror` exists because some devices do deliver mirrored frames. Verify on
 * the device before setting it.
 */

import { t, tIn } from "../i18n";

export interface StillOptions {
  /** JPEG quality, 0..1. */
  quality?: number;
  /** Width limit. 0 keeps the native resolution. */
  maxWidth?: number;
  /** Only set when the device is known to deliver mirrored frames. */
  mirror?: boolean;
  /** Burn L/R side markers into the corners. */
  sideMarkers?: boolean;
}

export interface Still {
  blob: Blob;
  width: number;
  height: number;
  /** Time relative to the start of the session, in milliseconds. */
  atMs: number;
}

let canvas: HTMLCanvasElement | null = null;

function surface(width: number, height: number): CanvasRenderingContext2D {
  canvas ??= document.createElement("canvas");
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(t("error.noStillContext"));
  return ctx;
}

/**
 * L/R markers in the bottom corners, after the fashion of a radiograph.
 *
 * They name the side of the PERSON, not of the image. An unmirrored frame
 * shows the person's right on the image left, so "R" goes left; a mirrored
 * frame swaps both.
 *
 * Always English, so the letters mean the same in every exported file. Drawn
 * with the transform reset, or a mirrored frame would produce mirrored text.
 */
function drawSideMarkers(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  mirror: boolean,
): void {
  const size = Math.max(16, Math.round(Math.min(width, height) / 18));
  const pad = Math.round(size * 0.6);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `bold ${size}px system-ui, sans-serif`;
  ctx.textBaseline = "alphabetic";
  ctx.lineWidth = Math.max(2, size / 8);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";

  const onLeft = tIn("en", mirror ? "side.left" : "side.right");
  const onRight = tIn("en", mirror ? "side.right" : "side.left");
  const y = height - pad;

  ctx.textAlign = "left";
  ctx.strokeText(onLeft, pad, y);
  ctx.fillText(onLeft, pad, y);

  ctx.textAlign = "right";
  ctx.strokeText(onRight, width - pad, y);
  ctx.fillText(onRight, width - pad, y);
}

export async function captureStill(
  video: HTMLVideoElement,
  atMs: number,
  options: StillOptions = {},
): Promise<Still> {
  const { quality = 0.92, maxWidth = 0, mirror = false, sideMarkers = true } = options;

  const nativeW = video.videoWidth;
  const nativeH = video.videoHeight;
  if (nativeW === 0 || nativeH === 0) throw new Error(t("error.noFrameYet"));

  const scale = maxWidth > 0 && nativeW > maxWidth ? maxWidth / nativeW : 1;
  const width = Math.round(nativeW * scale);
  const height = Math.round(nativeH * scale);

  const ctx = surface(width, height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (mirror) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, width, height);

  if (sideMarkers) drawSideMarkers(ctx, width, height, mirror);

  const blob = await new Promise<Blob | null>((resolve) =>
    (canvas as HTMLCanvasElement).toBlob(resolve, "image/jpeg", quality),
  );
  if (!blob) throw new Error(t("error.stillEncode"));

  return { blob, width, height, atMs };
}
