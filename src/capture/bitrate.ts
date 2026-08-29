/**
 * Bits per pixel and second. A fixed bitrate would be the real quality loss
 * at full resolution: a large frame the codec has nothing to fill it with.
 */
export const BITS_PER_PIXEL = 0.07;
export const MAX_BITRATE = 40_000_000;
export const MIN_BITRATE = 2_000_000;

export function bitrateFor(width: number, height: number, frameRate: number): number {
  const fps = frameRate > 0 ? frameRate : 30;
  const raw = Math.round(width * height * fps * BITS_PER_PIXEL);
  return Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, raw));
}
