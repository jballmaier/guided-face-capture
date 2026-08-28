/**
 * Camera access.
 *
 * Device selection rather than `facingMode` alone, so an external camera in a
 * fixed rig works unchanged.
 */

import { t } from "../i18n";

export interface CameraDevice {
  deviceId: string;
  label: string;
}

/**
 * Upper bound for the long edge. Includes a 12 MP sensor (4032 px), excludes a
 * 48 MP mode. A policy limit, not a technical one: a canvas costs width x
 * height x 4 bytes before anything is compressed.
 */
export const MAX_CAPTURE_EDGE = 4096;

export interface OpenCameraOptions {
  deviceId?: string;
  /** Upper bound for the long edge. 0 removes the limit. */
  maxEdge?: number;
  idealFrameRate?: number;
}

export interface ActiveCamera {
  stream: MediaStream;
  track: MediaStreamTrack;
  /** What the camera actually delivers, not what was requested. */
  settings: MediaTrackSettings;
  /** Front-facing? Controls the preview mirroring only. */
  isFrontFacing: boolean;
  label: string;
}

/** Device list. Labels are empty before the first grant - call after `openCamera`. */
export async function listCameras(): Promise<CameraDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === "videoinput")
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Kamera ${i + 1}` }));
}

/**
 * Opens the camera at the largest resolution on offer, up to the limit.
 *
 * Do not request an aspect ratio: asking for 1920x1080 forces 16:9 and crops a
 * 4:3 sensor top and bottom - on a face, in the direction it is long.
 */
export async function openCamera(options: OpenCameraOptions = {}): Promise<ActiveCamera> {
  const { deviceId, maxEdge = MAX_CAPTURE_EDGE, idealFrameRate = 30 } = options;

  // Never set deviceId and facingMode together: some browsers read the
  // combination as contradictory and open the wrong camera.
  const video: MediaTrackConstraints = deviceId
    ? { deviceId: { exact: deviceId } }
    : { facingMode: "user" };

  // Same target for both edges: the browser picks the mode closest to it,
  // which is the largest one under the limit, with no aspect ratio implied.
  const edge = maxEdge > 0 ? maxEdge : MAX_CAPTURE_EDGE;
  video.width = { ideal: edge };
  video.height = { ideal: edge };
  video.frameRate = { ideal: idealFrameRate };
  // Prefer a native mode over a browser-side downscale.
  (video as MediaTrackConstraints & { resizeMode?: ConstrainDOMString }).resizeMode = { ideal: "none" };

  const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
  const track = stream.getVideoTracks()[0];
  if (!track) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error(t("error.noVideoTrack"));
  }

  await raiseToMax(track, edge);

  const settings = track.getSettings();
  const label = track.label || "Kamera";
  return {
    stream,
    track,
    settings,
    isFrontFacing: detectFrontFacing(settings, label),
    label,
  };
}

/**
 * Second attempt via `applyConstraints`.
 *
 * Some browsers pick a smaller mode on open and only give more when asked
 * again - `getCapabilities` is available only once the track exists. On
 * failure the negotiated mode stands.
 */
async function raiseToMax(track: MediaStreamTrack, edge: number): Promise<void> {
  if (typeof track.getCapabilities !== "function") return;

  const caps = track.getCapabilities();
  const maxW = caps.width?.max;
  const maxH = caps.height?.max;
  if (!maxW || !maxH) return;

  // Keep the aspect ratio of the largest mode, shrink only to the limit.
  const scale = Math.min(1, edge / Math.max(maxW, maxH));
  const targetW = Math.round(maxW * scale);
  const targetH = Math.round(maxH * scale);

  const now = track.getSettings();
  if ((now.width ?? 0) * (now.height ?? 0) >= targetW * targetH) return;

  try {
    // No frame rate: many cameras drop below 30 fps at full resolution, and
    // resolution wins here.
    await track.applyConstraints({
      width: { ideal: targetW },
      height: { ideal: targetH },
      resizeMode: { ideal: "none" },
    } as MediaTrackConstraints);
  } catch (err) {
    console.warn("Hoehere Aufloesung nicht durchsetzbar", err);
  }
}

/** `facingMode` is usually unset on desktop, where the built-in camera faces the user. */
function detectFrontFacing(settings: MediaTrackSettings, label: string): boolean {
  if (settings.facingMode === "user") return true;
  if (settings.facingMode === "environment") return false;
  return !/back|rear|environment/i.test(label);
}

export function closeCamera(camera: ActiveCamera): void {
  camera.stream.getTracks().forEach((t) => t.stop());
}

/**
 * Attaches a stream to a video element and waits for dimensions.
 *
 * `playsInline` and `muted` are not optional on iOS: without them Safari pulls
 * playback into the fullscreen player and the guidance is gone.
 */
export async function attachStream(video: HTMLVideoElement, stream: MediaStream): Promise<void> {
  video.srcObject = stream;
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;

  if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
    await new Promise<void>((resolve, reject) => {
      const ok = () => {
        cleanup();
        resolve();
      };
      const fail = () => {
        cleanup();
        reject(new Error(t("error.streamFailed")));
      };
      const cleanup = () => {
        video.removeEventListener("loadedmetadata", ok);
        video.removeEventListener("error", fail);
      };
      video.addEventListener("loadedmetadata", ok, { once: true });
      video.addEventListener("error", fail, { once: true });
    });
  }
  await video.play();
}

/**
 * Frame loop. Uses `requestVideoFrameCallback` where available: one call per
 * video frame instead of per screen refresh.
 */
export function startFrameLoop(video: HTMLVideoElement, onFrame: (nowMs: number) => void): () => void {
  let stopped = false;

  // Via `unknown`: requestVideoFrameCallback is declared in some TypeScript
  // versions and not others.
  const rvfc = (
    video as unknown as {
      requestVideoFrameCallback?: (cb: (now: number) => void) => number;
    }
  ).requestVideoFrameCallback;

  if (typeof rvfc === "function") {
    const step = (now: number) => {
      if (stopped) return;
      onFrame(now);
      rvfc.call(video, step);
    };
    rvfc.call(video, step);
  } else {
    const step = (now: number) => {
      if (stopped) return;
      onFrame(now);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  return () => {
    stopped = true;
  };
}
