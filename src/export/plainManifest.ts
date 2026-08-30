import type { CameraProbe } from "../capture/capabilities";
import type { Recording } from "../capture/recorder";
import type { CueEvent } from "../basic/cues";
import { POSITIONS, type PositionId, type PositionSpec } from "../protocol/positions";
import { collectDeviceInfo, round } from "./manifest";
import {
  audioBlock,
  cameraBlock,
  clipFileName,
  positionHead,
  protocolBlock,
  sessionBlock,
  TIMEBASE_BLOCK,
  VIDEO_MANIFEST_VERSION,
  windowOf,
  windowOfKind,
  type AudioBlockInput,
  type ClipAttempt,
} from "./videoManifest";
import type { Locale } from "../i18n";

/**
 * Manifest der Nur-Video-Seite: gleicher Takt, andere Aufnahmekette.
 *
 * Das Protokoll ist dasselbe wie auf der gefuehrten Seite - ein Clip je
 * Position, Vorlauf, Halten, Nachlauf; die geteilten Bloecke kommen deshalb
 * aus `videoManifest.ts`. Was fehlt, fehlt absichtlich: keine Analyse, kein
 * Zuschnitt, keine Rahmenwache. Der MediaRecorder zapft den Kamerastrom
 * direkt an, deshalb gibt es hier keine gezeichneten Bilder zu zaehlen -
 * nur, was das Vorschau-Element nebenbei geliefert hat.
 */

export interface PlainClipResult {
  spec: PositionSpec;
  recording: Recording;
  events: readonly CueEvent[];
  /** Bilder, die das Vorschau-Element waehrend des Clips angezeigt hat.
   *  `null`, wenn der Browser sie nicht zaehlen kann (kein
   *  `requestVideoFrameCallback`) - dann wuerde die Zahl nur den
   *  Bildschirmtakt wiedergeben, das Gegenteil der gesuchten Auskunft. */
  previewFrames: number | null;
  startedAt: string;
  startedAtEpochMs: number;
  attempt: number;
  discardedAttempts: number;
  announcement: { text: string; wallMs: number } | null;
}

export interface PlainManifestInput {
  locale: Locale;
  startedAt: string;
  endedAt: string;
  wallMs: number;
  abortedReason: string | null;
  clips: ReadonlyMap<PositionId, PlainClipResult>;
  attempts: readonly ClipAttempt[];
  requestedFps: number;
  videoBitsPerSecond: number;
  maxEdge: number;
  cameraSettings: MediaTrackSettings;
  cameraProbe: CameraProbe | null;
  frameRateFloor: number | null;
  cameraLabel: string;
  isFrontFacing: boolean;
  audio: AudioBlockInput;
}

export function buildPlainManifest(input: PlainManifestInput): Record<string, unknown> {
  const kept = [...input.clips.values()];
  const recordedMs = kept.reduce((sum, c) => sum + c.recording.durationMs, 0);

  return {
    manifestVersion: VIDEO_MANIFEST_VERSION,
    /** Unterscheidet dieses Buendel von den Clips mit Zuschnitt. */
    profile: "guided-video-clips-plain",
    protocol: protocolBlock(),
    session: sessionBlock({
      locale: input.locale,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      wallMs: input.wallMs,
      recordedMs,
      clipsRecorded: kept.length,
      attempts: input.attempts,
      abortedReason: input.abortedReason,
    }),
    timebase: TIMEBASE_BLOCK,
    capture: {
      pipeline: {
        kind: "camera-stream-direct",
        note: "MediaRecorder taps the camera stream itself - no canvas, no re-encode, no analysis. previewFrames under positions[].video counts frames the preview element presented (a lower bound on camera delivery, not the encoder's rate); null when the browser cannot count delivered frames.",
      },
      video: {
        videoBitsPerSecond: input.videoBitsPerSecond,
        requestedFrameRate: input.requestedFps,
        maxEdge: input.maxEdge,
        files: "one per position, see positions[].video",
      },
      /** Kein Zuschnitt - die Dateien zeigen das volle Kamerabild. */
      crop: null,
      camera: cameraBlock(input),
      mirrorApplied: false,
      sideMarkers: false,
    },
    audio: audioBlock(input.audio),
    /** Bewusst null: auf dieser Seite laeuft kein Modell. */
    model: null,
    device: collectDeviceInfo(),
    positions: POSITIONS.map((spec) =>
      describePosition(spec, input.clips.get(spec.id), input.locale),
    ),
  };
}

function describePosition(
  spec: PositionSpec,
  clip: PlainClipResult | undefined,
  locale: Locale,
): Record<string, unknown> {
  const head = positionHead(spec, locale);

  if (!clip) {
    return { ...head, recorded: false, video: null, holds: [] };
  }

  const previewFps =
    clip.previewFrames !== null && clip.recording.durationMs > 0
      ? round((clip.previewFrames * 1000) / clip.recording.durationMs, 1)
      : null;

  return {
    ...head,
    recorded: true,
    attempt: clip.attempt,
    discardedAttempts: clip.discardedAttempts,
    video: {
      file: clipFileName(spec, clip.recording.mimeType),
      mimeType: clip.recording.mimeType,
      bytes: clip.recording.bytes,
      durationMs: Math.round(clip.recording.durationMs),
      previewFrames: clip.previewFrames,
      previewFrameRate: previewFps,
    },
    timebase: {
      startedAt: clip.startedAt,
      startedAtEpochMs: clip.startedAtEpochMs,
    },
    announcement: clip.announcement,
    lead: windowOfKind(clip.events, "lead"),
    holds: clip.events
      .filter((e) => e.step.kind === "hold")
      .map((e) => ({ rep: e.step.rep, ...windowOf(e) })),
    tail: windowOfKind(clip.events, "tail"),
  };
}
