import type { CameraProbe } from "../capture/capabilities";
import type { CroppedRecording } from "../capture/croppedRecorder";
import type { FaceBoxSnapshot, RestSnapshot } from "../align/align";
import type { CueEvent } from "../basic/cues";
import type { VoiceInfo } from "../basic/voice";
import type { ModelInfo } from "../vision/landmarker";
import { fileExtensionFor } from "../capture/recorder";
import {
  positionLabelIn,
  positionSlug,
  POSITIONS,
  type PositionId,
  type PositionSpec,
} from "../protocol/positions";
import { collectDeviceInfo, round, roundMetrics } from "./manifest";
import { ALIGN_HOLD_MS } from "../align/align";
import { POSE_TOLERANCE } from "../vision/pose";
import { QUALITY_THRESHOLDS } from "../vision/quality";
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
 * Manifest der gefuehrten Aufnahme - ein Clip je Position.
 *
 * The clips are the recording; this file is what makes them usable. Each clip
 * holds one position and nothing else, so the hard question of the previous
 * design - which second of a long video shows which expression - does not
 * arise any more. What remains to be written down is the frame the clips were
 * cut to, the resting face they should be normalised against, and per clip
 * when the movement was actually asked for.
 *
 * Announcements are deliberately in none of the files: they run before the
 * recording. Their text is kept here, so it stays known what the person was
 * told.
 */

export const VIDEO_MANIFEST_VERSION = 2;

/** Befund einer Probe der Rahmenwache. */
export type FrameWatchState = "inside" | "outside" | "no-face";

export interface FrameWatchSample {
  /** Auf der Zeitachse des Clips. */
  t: number;
  state: FrameWatchState;
}

/**
 * Was die Rahmenwache waehrend eines Clips gesehen hat.
 *
 * Die Reihe ist bewusst vollstaendig: Sie beantwortet nicht nur, ob es
 * Ausreisser gab, sondern auch wann - und damit, welche Wiederholung betroffen
 * ist. Bei zwei Proben je Sekunde und neun Sekunden Clip kostet das nichts.
 */
export interface FrameWatchReport {
  intervalMs: number;
  samples: number;
  insideSamples: number;
  outsideSamples: number;
  noFaceSamples: number;
  longestOutsideMs: number;
  series: FrameWatchSample[];
}

/** Ein Aufnahmeversuch, behalten oder verworfen. */
export interface ClipAttempt {
  id: PositionId;
  attempt: number;
  kept: boolean;
  /** Warum verworfen - null bei behaltenen. */
  discardReason: string | null;
  startedAtEpochMs: number;
  durationMs: number;
}

/** Ein behaltener Clip mit allem, was waehrend seiner Aufnahme gemessen wurde. */
export interface ClipResult {
  spec: PositionSpec;
  captured: CroppedRecording;
  events: readonly CueEvent[];
  frameWatch: FrameWatchReport | null;
  faceInsideCrop: { atStart: boolean | null; atEnd: boolean | null };
  startedAt: string;
  startedAtEpochMs: number;
  /** Der wievielte Versuch dieser Position hier liegt. */
  attempt: number;
  /** Wieviele Versuche davor verworfen wurden. */
  discardedAttempts: number;
  /** Was vor dem Clip angesagt wurde - in keiner Datei enthalten. */
  announcement: { text: string; wallMs: number } | null;
}

export interface VideoManifestInput {
  locale: Locale;
  startedAt: string;
  endedAt: string;
  /** Wanduhr der ganzen Sitzung, Ansagen und Wartezeiten eingeschlossen. */
  wallMs: number;
  abortedReason: string | null;
  /** Behaltene Clips, je Position hoechstens einer. */
  clips: ReadonlyMap<PositionId, ClipResult>;
  /** Alle Versuche in zeitlicher Reihenfolge, verworfene eingeschlossen. */
  attempts: readonly ClipAttempt[];
  fullFrame: boolean;
  requestedFps: number;
  videoBitsPerSecond: number;
  maxEdge: number;
  bitrateFactor: number;
  /** Zuschnitt und Ausgabegroesse gelten fuer alle Clips gleich. */
  rect: { x: number; y: number; w: number; h: number };
  source: { width: number; height: number };
  output: { width: number; height: number };
  cameraSettings: MediaTrackSettings;
  cameraProbe: CameraProbe | null;
  /** Verlangte Mindestbildrate, `null` wenn keine durchsetzbar war. */
  frameRateFloor: number | null;
  cameraLabel: string;
  isFrontFacing: boolean;
  analysisEdge: number;
  rest: RestSnapshot | null;
  faceBox: FaceBoxSnapshot | null;
  restStill: { file: string; width: number; height: number; bytes: number } | null;
  audio: { mode: string; speech: VoiceInfo; announcements: string };
  model: ModelInfo | null;
}

export interface CueWindow {
  startMs: number;
  endMs: number;
  plannedMs: number;
}

/** Dateiname eines Clips - verknuepft Datei und Manifest-Eintrag. */
export function clipFileName(spec: PositionSpec, mimeType: string): string {
  return `${positionSlug(spec)}.${fileExtensionFor(mimeType)}`;
}

export function buildVideoManifest(input: VideoManifestInput): Record<string, unknown> {
  const kept = [...input.clips.values()];
  const recordedMs = kept.reduce((sum, c) => sum + c.captured.recording.durationMs, 0);

  return {
    manifestVersion: VIDEO_MANIFEST_VERSION,
    /** Sagt einem Leser sofort, welche Art Buendel er vor sich hat. */
    profile: "guided-video-clips",
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
      /** Ganze Sitzung, mit Ansagen, Wartezeiten und verworfenen Versuchen. */
      wallMs: Math.round(input.wallMs),
      /** Summe der behaltenen Clips - so viel Video liegt im Paket. */
      recordedMs: Math.round(recordedMs),
      clipsPlanned: POSITIONS.length,
      clipsRecorded: kept.length,
      attempts: input.attempts.length,
      abortedReason: input.abortedReason,
      /** Tatsaechliche Reihenfolge, verworfene Versuche eingeschlossen. */
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
      /** Gemeinsames Profil - eine Kamera, ein Zuschnitt, alle Clips gleich. */
      video: {
        width: input.output.width,
        height: input.output.height,
        videoBitsPerSecond: input.videoBitsPerSecond,
        requestedFrameRate: input.requestedFps,
        maxEdge: input.maxEdge,
        bitrateFactor: input.bitrateFactor,
        files: "one per position, see positions[].video",
      },
      crop: {
        // Normalisiert auf das Kamerabild. Bei `applied: false` wurde das
        // Vollbild aufgezeichnet und das Rechteck ist ein Vorschlag fuer die
        // Auswertung, keine Beschreibung der Dateien.
        applied: !input.fullFrame,
        rect: {
          x: round(input.rect.x, 4),
          y: round(input.rect.y, 4),
          w: round(input.rect.w, 4),
          h: round(input.rect.h, 4),
        },
        rectPx: {
          x: Math.round(input.rect.x * input.source.width),
          y: Math.round(input.rect.y * input.source.height),
          w: Math.round(input.rect.w * input.source.width),
          h: Math.round(input.rect.h * input.source.height),
        },
        sourceWidth: input.source.width,
        sourceHeight: input.source.height,
        faceBox: input.faceBox
          ? {
              centerX: round(input.faceBox.centerX, 4),
              centerY: round(input.faceBox.centerY, 4),
              width: round(input.faceBox.width, 4),
              height: round(input.faceBox.height, 4),
              samples: input.faceBox.samples,
            }
          : null,
      },
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
        /** Als harte Bedingung verlangte Mindestbildrate, `null` wenn keine
         *  durchsetzbar war. `frameRate` daneben ist die Zusage der Kamera -
         *  was ankam, steht je Clip in `video.sourceFrameRate`. */
        frameRateFloor: input.frameRateFloor,
      },
      alignment: {
        holdMs: ALIGN_HOLD_MS,
        analysisEdge: input.analysisEdge,
        poseTolerance: POSE_TOLERANCE,
        qualityThresholds: QUALITY_THRESHOLDS,
      },
      /**
       * Ruhe-Baseline aus der Ausrichtung. Sie gilt fuer alle Clips: ohne sie
       * sind die auf die Ruhe bezogenen Signale nicht rekonstruierbar, und der
       * Vergleich zweier Termine haengt an ihr.
       */
      restBaseline: input.rest
        ? {
            pose: {
              yaw: round(input.rest.pose.yaw, 2),
              pitch: round(input.rest.pose.pitch, 2),
              roll: round(input.rest.pose.roll, 2),
            },
            metrics: roundMetrics(input.rest.metrics),
            samples: input.rest.samples,
          }
        : null,
      restStill: input.restStill,
      /** Die Clips sind nicht gespiegelt und tragen keine Tonspur. */
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
    model: input.model
      ? {
          name: input.model.model,
          variant: input.model.variant,
          version: input.model.version,
          landmarks: 478,
          runtime: "@mediapipe/tasks-vision",
          usedFor: "alignment-crop-and-frame-watch",
        }
      : null,
    device: collectDeviceInfo(),
    positions: POSITIONS.map((spec) =>
      describePosition(spec, input.clips.get(spec.id), input.locale),
    ),
  };
}

function describePosition(
  spec: PositionSpec,
  clip: ClipResult | undefined,
  locale: Locale,
): Record<string, unknown> {
  const head = {
    id: spec.id,
    index: spec.index,
    slug: positionSlug(spec),
    /** Immer Englisch, unabhaengig von der Anzeigesprache. */
    label: positionLabelIn("en", spec),
    /** Zusaetzlich in der Sprache, in der angesagt wurde. */
    labelSpoken: positionLabelIn(locale, spec),
  };

  if (!clip) {
    // Nicht aufgenommen - die Sitzung endete vorher oder wurde abgebrochen.
    return { ...head, recorded: false, video: null, holds: [], frameWatch: null };
  }

  const rec = clip.captured;
  const effectiveFps =
    rec.recording.durationMs > 0 ? (rec.drawnFrames * 1000) / rec.recording.durationMs : 0;
  const sourceFps =
    rec.recording.durationMs > 0 ? (rec.sourceFrames * 1000) / rec.recording.durationMs : 0;

  return {
    ...head,
    recorded: true,
    attempt: clip.attempt,
    discardedAttempts: clip.discardedAttempts,
    video: {
      file: clipFileName(spec, rec.recording.mimeType),
      mimeType: rec.recording.mimeType,
      bytes: rec.recording.bytes,
      durationMs: Math.round(rec.recording.durationMs),
      drawnFrames: rec.drawnFrames,
      effectiveFrameRate: round(effectiveFps, 1),
      /** Was die Kamera der Zeichenschleife angeboten hat. Weicht es von
       *  `effectiveFrameRate` ab, hat der Ratendeckel Bilder verworfen; liegt
       *  es unter `requestedFrameRate`, liefert die Kamera nicht genug. */
      sourceFrameRate: round(sourceFps, 1),
      firstDrawnFrameAtMs: Math.round(rec.firstFrameAtMs),
    },
    timebase: {
      startedAt: clip.startedAt,
      startedAtEpochMs: clip.startedAtEpochMs,
    },
    /** Was vor der Aufnahme gesagt wurde - in dieser Datei ist es nicht. */
    announcement: clip.announcement,
    /** Alle Zeiten ab Beginn dieses Clips. */
    lead: windowOfKind(clip.events, "lead"),
    holds: clip.events
      .filter((e) => e.step.kind === "hold")
      .map((e) => ({ rep: e.step.rep, ...windowOf(e) })),
    tail: windowOfKind(clip.events, "tail"),
    frameWatch: clip.frameWatch,
    faceInsideCrop: clip.faceInsideCrop,
  };
}

/** Auch vom Plain-Manifest genutzt - gleicher Takt, andere Aufnahmekette. */
export function windowOfKind(events: readonly CueEvent[], kind: string): CueWindow | null {
  const event = events.find((e) => e.step.kind === kind);
  return event ? windowOf(event) : null;
}

export function windowOf(event: CueEvent): CueWindow {
  return {
    startMs: Math.round(event.startMs),
    endMs: Math.round(event.endMs),
    plannedMs: event.step.plannedMs,
  };
}
