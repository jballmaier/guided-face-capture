import type { CameraProbe } from "../capture/capabilities";
import { fileExtensionFor } from "../capture/recorder";
import { positionSlug, positionLabelIn } from "../protocol/positions";
import { getLocale } from "../i18n";
import { tuningReport } from "../protocol/tuning";
import type { SessionResult } from "../session/session";
import type { ModelInfo } from "../vision/landmarker";

/**
 * The manifest is the actual record; the images are its attachments.
 *
 * It holds the conditions under which the measurement was taken. Without
 * negotiated resolution, head pose and model version, two sessions months
 * apart are not comparable.
 *
 * The full blendshape vector at the apex is stored rather than a derived
 * figure: which measure the analysis will need is not decided yet, and the
 * vector costs under a kilobyte.
 */

/**
 * Raised when fields change or disappear. New fields alone are not a reason:
 * a reader that does not know them skips them.
 */
export const MANIFEST_VERSION = 1;

export interface DeviceInfo {
  userAgent: string;
  platform: string;
  devicePixelRatio: number;
  screen: { width: number; height: number };
}

export interface ManifestInput {
  session: SessionResult;
  cameraSettings: MediaTrackSettings;
  /** What the camera would have offered beyond that. Null for file sources. */
  cameraProbe: CameraProbe | null;
  cameraLabel: string;
  /** Edge length the detection ran on - not that of the images. */
  analysis: { edge: number };
  /** Target bitrate actually used for the recording. */
  videoBitsPerSecond: number;
  isFrontFacing: boolean;
  model: ModelInfo;
  mirrorApplied: boolean;
}

export function collectDeviceInfo(): DeviceInfo {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    devicePixelRatio: window.devicePixelRatio,
    screen: { width: window.screen.width, height: window.screen.height },
  };
}

export function buildManifest(input: ManifestInput): Record<string, unknown> {
  const { session, cameraSettings, cameraProbe, cameraLabel, analysis, videoBitsPerSecond, isFrontFacing, model, mirrorApplied } =
    input;
  const videoName = `video.${fileExtensionFor(session.recording.mimeType)}`;

  return {
    manifestVersion: MANIFEST_VERSION,
    protocol: {
      // An id, not a display name: machine-readable and language-independent.
      id: "expression-set-12",
      description:
        "Twelve standardised facial expressions plus a video of the whole sequence.",
      /**
       * Thresholds changed on the device, before and after, per position.
       * Empty means measured unchanged; anything here marks a calibration run.
       */
      thresholdsChanged: tuningReport(),
    },
    session: {
      /** Display language during the session - explains the instructions shown. */
      locale: getLocale(),
      startedAt: session.startedAt,
      durationMs: Math.round(session.durationMs),
    },
    capture: {
      video: {
        file: videoName,
        mimeType: session.recording.mimeType,
        bytes: session.recording.bytes,
        // Target, not measurement: what the codec made of it is in bytes.
        videoBitsPerSecond,
      },
      camera: {
        label: cameraLabel,
        isFrontFacing,
        // What the camera actually delivered, not what was requested.
        width: cameraSettings.width ?? null,
        height: cameraSettings.height ?? null,
        frameRate: cameraSettings.frameRate ?? null,
        deviceId: cameraSettings.deviceId ?? null,
        facingMode: cameraSettings.facingMode ?? null,
        // And what was left unused: otherwise a small image cannot be told
        // apart from a device that could not do better.
        resizeMode: cameraProbe?.delivered.resizeMode ?? null,
        offered: cameraProbe?.offered ?? null,
        offeredFactor: cameraProbe?.videoFactor ?? null,
        photo: cameraProbe?.photo ?? null,
        photoFactor: cameraProbe?.photoFactor ?? null,
      },
      /**
       * Detection ran on a downscaled copy, the images come from the full
       * frame. Thresholds are only comparable when this is known.
       */
      analysisEdge: analysis.edge,
      // Whether mirroring was applied on saving, and whether the stills carry
      // burnt-in L/R markers. Without both the side of a finding cannot be
      // verified.
      sideMarkers: true,
      mirrorApplied,
    },
    model: {
      name: model.model,
      variant: model.variant,
      version: model.version,
      landmarks: 478,
      runtime: "@mediapipe/tasks-vision",
    },
    device: collectDeviceInfo(),
    positions: session.results.map((result) => {
      const slug = positionSlug(result.spec);
      return {
        id: result.spec.id,
        index: result.spec.index,
        /** Always English, whatever the display language. See `session.locale`. */
        label: positionLabelIn("en", result.spec),
        file: result.still ? `${slug}.jpg` : null,
        image: result.still ? { width: result.still.width, height: result.still.height, bytes: result.still.blob.size } : null,
        /** Position in the video, so the still can be found there. */
        atMs: result.apex ? Math.round(result.apex.atMs) : null,
        // The thresholds this particular position was measured under.
        thresholds: result.thresholds,
        capture: {
          triggered: result.triggered,
          capturedManually: result.capturedManually,
          timedOut: result.timedOut,
          attempts: result.attempts,
        },
        apex: result.apex
          ? {
              drive: round(result.apex.drive, 4),
              pose: {
                yaw: round(result.apex.pose.yaw, 2),
                pitch: round(result.apex.pose.pitch, 2),
                roll: round(result.apex.pose.roll, 2),
              },
              quality: {
                sharpness: round(result.apex.quality.sharpness, 1),
                luminance: round(result.apex.quality.luminance, 1),
                clipping: round(result.apex.quality.clipping, 4),
                interocular: round(result.apex.quality.interocular, 4),
                interocularPx: round(result.apex.quality.interocularPx, 1),
              },
              metrics: {
                eyeOpeningRight: round(result.apex.metrics.eyeOpeningRight, 4),
                eyeOpeningLeft: round(result.apex.metrics.eyeOpeningLeft, 4),
                interlabialGap: round(result.apex.metrics.interlabialGap, 4),
                mouthWidth: round(result.apex.metrics.mouthWidth, 4),
                philtrumToCornerRight: round(result.apex.metrics.philtrumToCornerRight, 4),
                philtrumToCornerLeft: round(result.apex.metrics.philtrumToCornerLeft, 4),
              },
              blendshapes: roundMap(result.apex.blendshapes, 4),
            }
          : null,
        driveSeries: result.driveSeries.map((s) => ({
          t: Math.round(s.t),
          drive: round(s.drive, 3),
          suppress: round(s.suppress, 3),
        })),
      };
    }),
  };
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function roundMap(map: Readonly<Record<string, number>>, digits: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(map)) out[k] = round(v, digits);
  return out;
}
