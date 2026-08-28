/**
 * What the camera offers against what actually arrives.
 *
 * A getUserMedia stream is not the sensor: it is the video path, binned or
 * cropped to the negotiated mode. How far that is from what the device can do
 * has to be read off per device - `getCapabilities` for the video path,
 * `ImageCapture` for the photo path.
 *
 * Neither is available everywhere. Missing values are normal, not an error:
 * they stay null and are shown as such.
 */

import { t } from "../i18n";

export interface CameraProbe {
  /**
   * Name of the measured camera. Front and rear can report identical maxima;
   * without the name a failed camera switch looks like a real result.
   */
  label: string;
  /** What the track actually delivers. */
  delivered: {
    width: number | null;
    height: number | null;
    frameRate: number | null;
    /**
     * `none` is a native camera mode. `crop-and-scale` means the browser
     * downscaled a larger mode to the requested size.
     */
    resizeMode: string | null;
  };
  /** Largest video mode the device offers. */
  offered: {
    maxWidth: number | null;
    maxHeight: number | null;
    maxFrameRate: number | null;
    resizeModes: readonly string[];
  } | null;
  /** Photo path via ImageCapture. */
  photo: {
    supported: boolean;
    maxWidth: number | null;
    maxHeight: number | null;
    /** Why no value is available - for the readout and the manifest. */
    note: string | null;
  };
  /** Pixel-count factor against the delivered frame. 1 means nothing is left unused. */
  videoFactor: number | null;
  photoFactor: number | null;
}

/** Minimal shape of `ImageCapture`; the DOM types do not declare it. */
interface PhotoCapabilities {
  imageWidth?: { max?: number };
  imageHeight?: { max?: number };
}
type ImageCaptureLike = { getPhotoCapabilities(): Promise<PhotoCapabilities> };
type ImageCaptureCtor = new (track: MediaStreamTrack) => ImageCaptureLike;

function factor(fromW: number | null, fromH: number | null, toW: number | null, toH: number | null): number | null {
  if (!fromW || !fromH || !toW || !toH) return null;
  return (toW * toH) / (fromW * fromH);
}

/**
 * Queries track and photo path once per opened camera.
 *
 * Not per frame: `getPhotoCapabilities` talks to the camera and can stall the
 * preview on some devices.
 */
export async function probeCamera(track: MediaStreamTrack): Promise<CameraProbe> {
  const settings = track.getSettings();
  const delivered = {
    width: settings.width ?? null,
    height: settings.height ?? null,
    frameRate: settings.frameRate ?? null,
    // resizeMode is missing from some DOM type versions.
    resizeMode: (settings as MediaTrackSettings & { resizeMode?: string }).resizeMode ?? null,
  };

  let offered: CameraProbe["offered"] = null;
  if (typeof track.getCapabilities === "function") {
    const caps = track.getCapabilities() as MediaTrackCapabilities & { resizeMode?: string[] };
    offered = {
      maxWidth: caps.width?.max ?? null,
      maxHeight: caps.height?.max ?? null,
      maxFrameRate: caps.frameRate?.max ?? null,
      resizeModes: caps.resizeMode ?? [],
    };
  }

  const photo = await probePhoto(track);

  return {
    label: track.label || "unbenannte Kamera",
    delivered,
    offered,
    photo,
    videoFactor: factor(delivered.width, delivered.height, offered?.maxWidth ?? null, offered?.maxHeight ?? null),
    photoFactor: factor(delivered.width, delivered.height, photo.maxWidth, photo.maxHeight),
  };
}

async function probePhoto(track: MediaStreamTrack): Promise<CameraProbe["photo"]> {
  const ctor = (globalThis as { ImageCapture?: ImageCaptureCtor }).ImageCapture;
  if (!ctor) {
    return {
      supported: false,
      maxWidth: null,
      maxHeight: null,
      note: t("camera.photoMissing"),
    };
  }
  try {
    const caps = await new ctor(track).getPhotoCapabilities();
    return {
      supported: true,
      maxWidth: caps.imageWidth?.max ?? null,
      maxHeight: caps.imageHeight?.max ?? null,
      note: null,
    };
  } catch (err) {
    return {
      supported: false,
      maxWidth: null,
      maxHeight: null,
      note: `${t("camera.photoNoSize")}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
