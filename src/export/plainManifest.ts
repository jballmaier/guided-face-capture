import type { CameraProbe } from "../capture/capabilities";
import type { Recording } from "../capture/recorder";
import type { CueEvent } from "../basic/cues";
import type { VoiceInfo } from "../basic/voice";
import {
  positionLabelIn,
  positionSlug,
  POSITIONS,
  type PositionId,
  type PositionSpec,
} from "../protocol/positions";
import { collectDeviceInfo, round } from "./manifest";
import { clipFileName, windowOf, windowOfKind, type ClipAttempt } from "./videoManifest";
import {
  HOLD_MS,
  LEAD_MS,
  NEUTRAL_HOLD_MS,
  RELEASE_MS,
  REPETITIONS,
  TAIL_MS,
} from "../basic/cues";
import type { Locale } from "../i18n";

/**
 * Manifest der Nur-Video-Seite: gleicher Takt, andere Aufnahmekette.
 *
 * Das Protokoll ist dasselbe wie auf der gefuehrten Seite - ein Clip je
 * Position, Vorlauf, Halten, Nachlauf. Was fehlt, fehlt absichtlich: keine
 * Analyse, kein Zuschnitt, keine Rahmenwache. Der MediaRecorder zapft den
 * Kamerastrom direkt an, deshalb gibt es hier keine gezeichneten Bilder zu
 * zaehlen - nur, was das Vorschau-Element nebenbei geliefert hat.
 */

export interface PlainClipResult {
  spec: PositionSpec;
  recording: Recording;
  events: readonly CueEvent[];
  /** Bilder, die das Vorschau-Element waehrend des Clips angezeigt hat. */
  previewFrames: number;
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
  audio: { mode: string; speech: VoiceInfo; announcements: string };
}

export function buildPlainManifest(input: PlainManifestInput): Record<string, unknown> {
  const kept = [...input.clips.values()];
  const recordedMs = kept.reduce((sum, c) => sum + c.recording.durationMs, 0);

  return {
    manifestVersion: 2,
    /** Unterscheidet dieses Buendel von den Clips mit Zuschnitt. */
    profile: "guided-video-clips-plain",
    protocol: {
      id: "expression-set-12",
      variant: "guided-clips-3x1s",
      description:
        "Twelve standardised facial expressions, one clip per position: a second at rest, three one-second holds, a second at rest. Cued acoustically; the announcement runs before the clip and is in no file.",
      repetitions: REPETITIONS,
      holdMs: HOLD_MS,
      releaseMs: RELEASE_MS,
      neutralHoldMs: NEUTRAL_HOLD_MS,
      leadMs: LEAD_MS,
      tailMs: TAIL_MS,
    },
    session: {
      locale: input.locale,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      wallMs: Math.round(input.wallMs),
      recordedMs: Math.round(recordedMs),
      clipsPlanned: POSITIONS.length,
      clipsRecorded: kept.length,
      attempts: input.attempts.length,
      abortedReason: input.abortedReason,
      clipOrder: input.attempts.map((a) => ({
        id: a.id,
        attempt: a.attempt,
        kept: a.kept,
        discardReason: a.discardReason,
        startedAtEpochMs: a.startedAtEpochMs,
        durationMs: Math.round(a.durationMs),
      })),
    },
    timebase: {
      origin: "clip-start",
      clock: "performance.now",
      unit: "ms",
      note: "Every clip has its own zero. All times under positions[] are relative to that clip; positions[].timebase carries its wall-clock anchor. Cue times are measured, not planned - plannedMs states what was asked for.",
    },
    capture: {
      pipeline: {
        kind: "camera-stream-direct",
        note: "MediaRecorder taps the camera stream itself - no canvas, no re-encode, no analysis. previewFrames under positions[].video counts frames the preview element presented; a lower bound on camera delivery, not the encoder's rate.",
      },
      video: {
        videoBitsPerSecond: input.videoBitsPerSecond,
        requestedFrameRate: input.requestedFps,
        maxEdge: input.maxEdge,
        files: "one per position, see positions[].video",
      },
      /** Kein Zuschnitt - die Dateien zeigen das volle Kamerabild. */
      crop: null,
      camera: {
        label: input.cameraLabel,
        isFrontFacing: input.isFrontFacing,
        width: input.cameraSettings.width ?? null,
        height: input.cameraSettings.height ?? null,
        frameRate: input.cameraSettings.frameRate ?? null,
        deviceId: input.cameraSettings.deviceId ?? null,
        facingMode: input.cameraSettings.facingMode ?? null,
        resizeMode: input.cameraProbe?.delivered.resizeMode ?? null,
        offered: input.cameraProbe?.offered ?? null,
        offeredFactor: input.cameraProbe?.videoFactor ?? null,
        frameRateFloor: input.frameRateFloor,
      },
      mirrorApplied: false,
      sideMarkers: false,
    },
    audio: {
      mode: input.audio.mode,
      speech: input.audio.speech,
      /** verbose | brief | tones - wie viel vor jedem Clip gesprochen wurde. */
      announcements: input.audio.announcements,
      note: "Announcements play before each clip and are in no file. The clips carry no audio track.",
    },
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
  const head = {
    id: spec.id,
    index: spec.index,
    slug: positionSlug(spec),
    label: positionLabelIn("en", spec),
    labelSpoken: positionLabelIn(locale, spec),
  };

  if (!clip) {
    return { ...head, recorded: false, video: null, holds: [] };
  }

  const previewFps =
    clip.recording.durationMs > 0
      ? (clip.previewFrames * 1000) / clip.recording.durationMs
      : 0;

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
      previewFrameRate: round(previewFps, 1),
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
