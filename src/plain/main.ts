import "../ui/styles.css";
import {
  attachStream,
  closeCamera,
  listCameras,
  openCamera,
  startFrameLoop,
  type ActiveCamera,
} from "../capture/camera";
import { probeCamera, type CameraProbe } from "../capture/capabilities";
import { bitrateFor } from "../capture/bitrate";
import { MP4_FIRST_MIME_CANDIDATES, SequenceRecorder } from "../capture/recorder";
import {
  POSITIONS,
  positionById,
  positionInstruction,
  positionLabel,
  type PositionId,
  type PositionSpec,
} from "../protocol/positions";
import {
  announcementFor,
  buildPositionScript,
  CueRunner,
  loadAnnounceMode,
  saveAnnounceMode,
  type AnnounceMode,
  type CueStep,
} from "../basic/cues";
import { Voice, type VoiceInfo } from "../basic/voice";
import { initSettingsSheet } from "../ui/sheet";
import { clipFileName, type ClipAttempt } from "../export/videoManifest";
import { buildPlainManifest, type PlainClipResult } from "../export/plainManifest";
import { downloadBlob, packZip } from "../export/bundle";
import { setWakeLock, watchVisibility } from "../ui/wakeLock";
import { initTheme } from "../ui/theme";
import {
  applyTranslations,
  getLocale,
  initLocale,
  LOCALES,
  LOCALE_NAMES,
  onLocaleChange,
  setLocale,
  t,
  tIn,
  type Locale,
} from "../i18n";

/**
 * Nur-Video-Seite: koordiniert die Aufnahme und sonst nichts.
 *
 * Kein MediaPipe, keine Ausrichtung, kein Zuschnitt, keine Rahmenwache. Der
 * MediaRecorder zapft den Kamerastrom direkt an - kein Canvas dazwischen,
 * kein zweites Kodieren. Was diese Seite von der gefuehrten unterscheidet,
 * ist genau das, was auf einem iPhone eingebrochen ist (6 statt 30 Bilder je
 * Sekunde, gemessen 2026-08-30): faellt die Aufnahme hier genauso, liegt es
 * nicht an der Analysekette.
 *
 * Der Takt bleibt derselbe - Ansage vor dem Clip, ein Clip je Position,
 * Toene fuer die Sekunden. Einrichten muss sich die Person selbst; der
 * Spiegel ist die einzige Rueckmeldung.
 */

type PlainState = "idle" | "ready" | "running" | "done";

/**
 * Erst `clip` schreibt eine Datei. Eine eigene Ansage-Phase gibt es nicht
 * mehr: der Aufnahmeknopf ist sofort scharf, die Ansage laeuft nebenher und
 * wird vom Druck abgebrochen - wer den Ablauf kennt, wartet auf nichts.
 */
type RunPhase = "armed" | "clip";

type RunSignal = "clip" | "repeat" | "abort";

const RECORD_FPS = 30;

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Element #${id} fehlt im HTML`);
  return node as T;
};

const stage = el<HTMLElement>("stage");
const video = el<HTMLVideoElement>("preview");
const stageEmpty = el<HTMLElement>("stage-empty");
const hints = el<HTMLElement>("hints");
const prompt = el<HTMLElement>("prompt");
const promptStep = el<HTMLElement>("prompt-step");
const promptTitle = el<HTMLElement>("prompt-title");
const promptInstruction = el<HTMLElement>("prompt-instruction");
const progressFill = el<HTMLElement>("progress-fill");
const markLeft = el<HTMLElement>("mark-left");
const markRight = el<HTMLElement>("mark-right");
const localeSelect = el<HTMLSelectElement>("locale-select");
const cameraSelect = el<HTMLSelectElement>("camera-select");
const sizeSelect = el<HTMLSelectElement>("size-select");
const announceSelect = el<HTMLSelectElement>("announce-select");
const toggleLight = el<HTMLInputElement>("toggle-light");
const btnStart = el<HTMLButtonElement>("btn-start");
const btnGuide = el<HTMLButtonElement>("btn-guide");
const btnClip = el<HTMLButtonElement>("btn-clip");
const btnRepeat = el<HTMLButtonElement>("btn-repeat");
const btnAbort = el<HTMLButtonElement>("btn-abort");
const btnExport = el<HTMLButtonElement>("btn-export");
const btnAgain = el<HTMLButtonElement>("btn-again");
const status = el<HTMLElement>("status");

let state: PlainState = "idle";
let phase: RunPhase = "armed";
let announceMode: AnnounceMode = loadAnnounceMode();
/** Modus der laufenden Sitzung - eingefroren, damit das Manifest nicht luegt,
 *  wenn der Regler nach der Sitzung umgestellt wird. */
let sessionAnnounce: AnnounceMode = announceMode;
let camera: ActiveCamera | null = null;
let cameraProbe: CameraProbe | null = null;
let lightMode = false;

/** Recorder des laufenden Clips - je Clip ein frischer. */
let activeRecorder: SequenceRecorder | null = null;
/** Beendet die Bildzaehlung des laufenden Clips. */
let stopClipFrames: (() => void) | null = null;
let runner: CueRunner | null = null;
let voice: Voice | null = null;
let sessionLocale: Locale = "en";
let sessionBitrate = 0;
let startedAt = "";
let endedAt = "";
let sessionWallStart = 0;
let abortedReason: string | null = null;

const clips = new Map<PositionId, PlainClipResult>();
const attemptsOf = new Map<PositionId, number>();
let attemptLog: ClipAttempt[] = [];
let patternSpoken = false;
let lastRecorded: PositionId | null = null;
let lastAnnouncement: { text: string; wallMs: number } | null = null;

let pending: ((signal: RunSignal) => void) | null = null;
let discardRequested: string | null = null;

let cameraLine = "";
let exporting = false;
let voiceMode = "tones";
let voiceInfo: VoiceInfo = { available: false, name: null, lang: null, localService: false };

function setStatus(text: string, bad = false): void {
  status.textContent = text;
  status.classList.toggle("bad", bad);
}

function reportError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  setStatus(t("status.error", { message }), true);
  console.error(err);
}

// ------------------------------------------------------------------ Anzeige

function renderButtons(): void {
  const running = state === "running";
  btnStart.hidden = running;
  btnGuide.hidden = state !== "ready";
  btnClip.hidden = !running || phase !== "armed";
  btnRepeat.hidden =
    lastRecorded === null || !((running && phase !== "clip") || state === "done");
  btnAbort.hidden = !running;
  btnExport.hidden = state !== "done" || clips.size === 0;
  btnAgain.hidden = state !== "done";
  markLeft.hidden = state === "idle";
  markRight.hidden = state === "idle";

  if (lastRecorded) {
    btnRepeat.textContent = t("btn.repeat", {
      name: positionLabel(positionById(lastRecorded)),
    });
  }

  const locked = running;
  localeSelect.disabled = locked;
  cameraSelect.disabled = locked || cameraSelect.options.length < 2;
  sizeSelect.disabled = locked;
  announceSelect.disabled = locked;
}

function renderHints(issues: string[], ok?: string): void {
  const items = issues.map((text) => ({ text, ok: false }));
  if (issues.length === 0 && ok) items.push({ text: ok, ok: true });
  hints.replaceChildren(
    ...items.map((m) => {
      const div = document.createElement("div");
      div.className = `hint ${m.ok ? "ok" : "bad"}`;
      div.textContent = m.text;
      return div;
    }),
  );
}

/** L/R wie auf einer Roentgenaufnahme - sie benennen die Seite der Person. */
function renderSideMarks(): void {
  const mirrored = stage.classList.contains("mirrored");
  markLeft.textContent = t(mirrored ? "side.left" : "side.right");
  markRight.textContent = t(mirrored ? "side.right" : "side.left");
}

function promptHeading(spec: PositionSpec, extra?: string): string {
  const base = t("stage.step", { number: spec.index, count: POSITIONS.length });
  return extra ? `${base} - ${extra}` : base;
}

function showPosition(spec: PositionSpec, armed: boolean): void {
  prompt.hidden = false;
  progressFill.style.width = "0%";
  progressFill.classList.remove("ready");
  promptStep.textContent = promptHeading(spec);
  promptTitle.textContent = positionLabel(spec);
  promptInstruction.textContent = armed
    ? `${positionInstruction(spec)} — ${t("basic.armed")}`
    : positionInstruction(spec);
}

function showStep(step: CueStep, at: number, total: number): void {
  const spec = positionById(step.positionId);
  prompt.hidden = false;
  progressFill.style.width = `${Math.round(((at + 1) / Math.max(1, total)) * 100)}%`;
  promptStep.textContent = promptHeading(
    spec,
    step.repCount > 1 && step.rep > 0
      ? t("basic.repOf", { rep: step.rep, count: step.repCount })
      : undefined,
  );
  promptTitle.textContent = positionLabel(spec);
  promptInstruction.textContent =
    step.kind === "hold" ? t("basic.holdNow") : t("basic.releaseNow");
  progressFill.classList.toggle("ready", step.kind === "hold");
}

// ------------------------------------------------------------------- Kamera

async function startCamera(): Promise<void> {
  btnStart.disabled = true;
  try {
    setStatus(t("status.openingCamera"));
    releaseCamera();
    const deviceId = cameraSelect.value || undefined;
    // Bildrate als Bedingung, Aufloesung als Wunsch - sonst waehlt der Browser
    // die Fotobetriebsart, und die liefert keine dreissig Bilder je Sekunde.
    camera = await openCamera({
      ...(deviceId ? { deviceId } : {}),
      maxEdge: Number.parseInt(sizeSelect.value, 10),
      minFrameRate: RECORD_FPS,
    });
    await attachStream(video, camera.stream);
    await fillCameraList(camera);

    stage.classList.toggle("mirrored", camera.isFrontFacing);
    renderSideMarks();

    try {
      cameraProbe = await probeCamera(camera.track);
    } catch {
      cameraProbe = null;
    }

    enterReady();
  } catch (err) {
    reportError(err);
  } finally {
    btnStart.disabled = false;
    btnStart.textContent = t("btn.switch");
  }
}

async function fillCameraList(active: ActiveCamera): Promise<void> {
  const devices = await listCameras();
  cameraSelect.replaceChildren(
    ...devices.map((d) => {
      const option = document.createElement("option");
      option.value = d.deviceId;
      option.textContent = d.label;
      option.selected = d.deviceId === active.settings.deviceId;
      return option;
    }),
  );
  cameraSelect.disabled = devices.length < 2;
}

function releaseCamera(): void {
  if (camera) closeCamera(camera);
  camera = null;
  cameraProbe = null;
}

/**
 * Kamera laeuft, nichts prueft - die Person richtet sich am Spiegel selbst
 * ein. Vor der Aufnahme steht hier, ob gesprochen wird: eine fehlende Stimme
 * faellt sonst erst nach der halben Sitzung auf.
 */
function enterReady(): void {
  state = "ready";
  stageEmpty.hidden = true;
  prompt.hidden = true;
  renderButtons();

  const settings = cameraProbe?.delivered ?? camera?.settings ?? {};
  cameraLine = t("status.cameraOpen", {
    width: settings.width ?? 0,
    height: settings.height ?? 0,
    fps: Math.round(settings.frameRate ?? 0),
    label: camera?.label ?? "Kamera",
  });

  const speech = Voice.describe(getLocale());
  const voiceLine = speech.available
    ? t("basic.voiceReady", { name: speech.name ?? "" })
    : t("basic.noVoice");
  setStatus(`${cameraLine} ${voiceLine} ${t("basic.soundHint")}`);
  renderHints([], t("plain.framingHint"));
  void setWakeLock(wakeWanted());
}

// -------------------------------------------------------------------- Folge

function signal(value: RunSignal): void {
  const resolve = pending;
  pending = null;
  resolve?.(value);
}

function waitForSignal(): Promise<RunSignal> {
  return new Promise<RunSignal>((resolve) => {
    pending = resolve;
  });
}

async function startGuidance(): Promise<void> {
  if (!camera) return;

  // Ton synchron in der Geste freischalten - ein `await` davor verbraucht sie
  // auf iOS. Die Freigabe gilt danach fuer die ganze Sitzung.
  sessionLocale = getLocale();
  sessionAnnounce = announceMode;
  voice = Voice.unlock(sessionLocale);
  voiceInfo = voice.info;
  voiceMode = voiceInfo.available && sessionAnnounce !== "tones" ? "speech+tones" : "tones";

  const settings = camera.track.getSettings();
  sessionBitrate = bitrateFor(
    settings.width ?? 1280,
    settings.height ?? 720,
    settings.frameRate ?? RECORD_FPS,
  );

  state = "running";
  abortedReason = null;
  clips.clear();
  attemptsOf.clear();
  attemptLog = [];
  patternSpoken = false;
  lastRecorded = null;
  startedAt = new Date().toISOString();
  sessionWallStart = performance.now();
  renderButtons();
  renderHints([]);
  void setWakeLock(wakeWanted());

  try {
    await runSequence(null);
  } catch (err) {
    reportError(err);
  }
  endSession();
}

/** `only` gesetzt: eine einzelne Position nachholen. */
async function runSequence(only: PositionId | null): Promise<void> {
  const order = only ? POSITIONS.filter((s) => s.id === only) : POSITIONS;
  let i = 0;

  while (i < order.length) {
    const spec = order[i]!;

    // 1. Ansage und Freigabe zugleich: der Knopf ist sofort scharf, die
    //    Ansage laeuft nebenher und landet in keiner Datei. Der Druck bricht
    //    sie ab - niemand muss sie zu Ende hoeren.
    phase = "armed";
    renderButtons();
    showPosition(spec, true);
    setStatus(`${promptHeading(spec)}: ${positionLabel(spec)} - ${t("basic.armed")}`);

    voice?.tone("next");
    if (sessionAnnounce === "tones") {
      lastAnnouncement = null;
    } else {
      const announcement = announcementFor(spec, sessionLocale, {
        sayPattern: !patternSpoken,
        brief: sessionAnnounce === "brief",
      });
      if (announcement.sayPattern) patternSpoken = true;
      // Die Dauer traegt sich selbst nach, sobald die Sprache endet - auch
      // beim Abbruch durch den Knopf, der `speak` aufloest.
      const captured = { text: announcement.text, wallMs: 0 };
      lastAnnouncement = captured;
      const wallStart = performance.now();
      void voice?.speak(announcement.text).then(() => {
        captured.wallMs = Math.round(performance.now() - wallStart);
      });
    }

    const go = await waitForSignal();
    // Was auch immer folgt - die Ansage endet, bevor etwas anderes beginnt.
    voice?.cancel();
    if (go === "abort") return;
    if (go === "repeat") {
      i = repeatTarget(order, i);
      continue;
    }

    // 2. Clip.
    phase = "clip";
    renderButtons();
    const outcome = await recordClip(spec);
    if (outcome === "abort") return;
    if (outcome === "discarded") continue;

    lastRecorded = spec.id;
    i += 1;
  }
}

function repeatTarget(order: readonly PositionSpec[], current: number): number {
  if (!lastRecorded) return current;
  const at = order.findIndex((s) => s.id === lastRecorded);
  return at < 0 ? current : at;
}

/**
 * Nimmt einen Clip auf - direkt vom Kamerastrom.
 *
 * Je Clip ein frischer MediaRecorder auf demselben Strom: eigene Datei,
 * eigene Zeitachse ab null. Nebenbei zaehlt eine Bildschleife, was das
 * Vorschau-Element liefert - der einzige Blick auf die Bildrate, den es ohne
 * Analysekette noch gibt, und im Manifest die Antwort auf die Frage, ob die
 * Kamera oder der Encoder gebremst hat.
 */
async function recordClip(spec: PositionSpec): Promise<"kept" | "discarded" | "abort"> {
  if (!camera || !voice) return "abort";

  const attempt = (attemptsOf.get(spec.id) ?? 0) + 1;
  attemptsOf.set(spec.id, attempt);

  const clipStartedAt = new Date().toISOString();
  const clipEpochMs = Date.now();
  discardRequested = null;

  const recorder = new SequenceRecorder(camera.stream, {
    videoBitsPerSecond: sessionBitrate,
    mimeCandidates: MP4_FIRST_MIME_CANDIDATES,
  });
  activeRecorder = recorder;
  recorder.start();

  let previewFrames = 0;
  let statusShownAt = 0;
  stopClipFrames = startFrameLoop(video, (nowMs) => {
    previewFrames += 1;
    if (nowMs - statusShownAt > 500 && recorder.elapsedMs > 1000) {
      statusShownAt = nowMs;
      const fps = (previewFrames * 1000) / recorder.elapsedMs;
      setStatus(`${t("basic.recording")} · ${t("plain.previewFps", { fps: fps.toFixed(0) })}`);
    }
  });

  runner = new CueRunner(buildPositionScript(spec), {
    voice,
    clock: () => recorder.elapsedMs,
    onStep: (step, at, total) => showStep(step, at, total),
  });

  const events = await runner.run();
  stopClipFrames();
  stopClipFrames = null;

  const recording = await recorder.stop();
  activeRecorder = null;

  // Erst nach dem Stop pruefbar: die MP4-Muxer von Chromium und iOS ignorieren
  // die Zeitscheibe und liefern alle Daten in einem Stueck beim Stop (gemessen
  // 2026-08-30) - ein Watchdog auf Zwischenbloecke wie auf der gefuehrten
  // Seite braeche hier gesunde Aufnahmen ab.
  if (recording.bytes === 0 && abortedReason === null && discardRequested === null) {
    abortedReason = "no-video-data";
  }

  const discarded = discardRequested;
  const aborted = abortedReason !== null;

  attemptLog.push({
    id: spec.id,
    attempt,
    kept: !discarded && !aborted,
    discardReason: discarded ?? (aborted ? abortedReason : null),
    startedAtEpochMs: clipEpochMs,
    durationMs: recording.durationMs,
  });

  if (aborted) return "abort";

  if (discarded) {
    renderHints([t("basic.discarded")]);
    voice.tone("warn");
    return "discarded";
  }

  clips.set(spec.id, {
    spec,
    recording,
    events,
    previewFrames,
    startedAt: clipStartedAt,
    startedAtEpochMs: clipEpochMs,
    attempt,
    discardedAttempts: attempt - 1,
    announcement: lastAnnouncement,
  });
  return "kept";
}

function endSession(): void {
  phase = "armed";
  prompt.hidden = true;
  endedAt = new Date().toISOString();
  state = "done";
  renderButtons();
  void setWakeLock(wakeWanted());

  const kept = [...clips.values()];
  const recordedMs = kept.reduce((sum, c) => sum + c.recording.durationMs, 0);
  const bytes = kept.reduce((sum, c) => sum + c.recording.bytes, 0);

  let text = t("plain.savedSession", {
    clips: kept.length,
    total: (bytes / 1024 / 1024).toFixed(1),
    seconds: (recordedMs / 1000).toFixed(0),
  });
  const discardedCount = attemptLog.filter((a) => !a.kept).length;
  if (discardedCount > 0) text += ` - ${t("basic.discardedCount", { count: discardedCount })}`;
  if (abortedReason) text = `${t("basic.stopped")} ${text}`;
  setStatus(text, Boolean(abortedReason) || kept.length < POSITIONS.length);
  renderHints(abortedReason === "no-video-data" ? [t("basic.noData")] : []);
}

function abortRun(reason: string): void {
  if (state !== "running") return;
  abortedReason = reason;
  runner?.abort();
  signal("abort");
}

/** Bricht den laufenden Clip ab; die Position wird danach wiederholt. */
function requestDiscard(reason: string): void {
  if (phase !== "clip" || discardRequested) return;
  discardRequested = reason;
  runner?.abort();
}

// -------------------------------------------------------------------- Export

async function exportBundle(): Promise<void> {
  if (clips.size === 0 || exporting) return;
  exporting = true;
  btnExport.disabled = true;
  try {
    setStatus(t("status.packing"));
    const manifest = buildPlainManifest({
      locale: sessionLocale,
      startedAt,
      endedAt,
      wallMs: performance.now() - sessionWallStart,
      abortedReason,
      clips,
      attempts: attemptLog,
      requestedFps: RECORD_FPS,
      videoBitsPerSecond: sessionBitrate,
      maxEdge: Number.parseInt(sizeSelect.value, 10),
      cameraSettings: camera?.track.getSettings() ?? {},
      cameraProbe,
      frameRateFloor: camera?.frameRateFloor ?? null,
      cameraLabel: camera?.label ?? "Kamera",
      isFrontFacing: camera?.isFrontFacing ?? false,
      audio: { mode: voiceMode, speech: voiceInfo, announcements: sessionAnnounce },
    });

    const files: Record<string, Uint8Array | string> = {};
    // Nacheinander lesen: beim Packen liegen die Daten ohnehin ein zweites Mal
    // im Speicher, also nicht auch noch alle Blobs gleichzeitig kopieren.
    for (const clip of clips.values()) {
      const name = clipFileName(clip.spec, clip.recording.mimeType);
      files[name] = new Uint8Array(await clip.recording.blob.arrayBuffer());
    }
    files["manifest.json"] = JSON.stringify(manifest, null, 2);
    files["README.txt"] = readme();

    const blob = await packZip(files);
    const stamp = startedAt.replace(/[:.]/g, "-").slice(0, 19);
    downloadBlob(blob, `plain-clips_${stamp}.zip`);

    setStatus(
      t("basic.savedZip", {
        clips: clips.size,
        total: (blob.size / 1024 / 1024).toFixed(1),
      }),
    );
  } catch (err) {
    reportError(err);
  } finally {
    exporting = false;
    btnExport.disabled = false;
  }
}

function readme(): string {
  const l = sessionLocale;
  return [
    tIn(l, "videoBundle.title"),
    "===========================================",
    "",
    tIn(l, "plainBundle.intro"),
    "",
    tIn(l, "videoBundle.contents"),
    "------",
    `  ${tIn(l, "plainBundle.clips")}`,
    `  ${tIn(l, "plainBundle.manifest")}`,
    "",
    tIn(l, "videoBundle.howto"),
    "---------------------------",
    `  1. ${tIn(l, "videoBundle.howto1")}`,
    `  2. ${tIn(l, "videoBundle.howto2")}`,
    `  3. ${tIn(l, "videoBundle.howto3")}`,
    "",
    tIn(l, "bundle.prototype"),
    "",
  ].join("\n");
}

// -------------------------------------------------------------------- Events

const wakeWanted = (): boolean => lightMode || state === "ready" || state === "running";

btnStart.addEventListener("click", () => void startCamera());
btnGuide.addEventListener("click", () => void startGuidance());
btnClip.addEventListener("click", () => signal("clip"));
btnRepeat.addEventListener("click", () => {
  if (state === "running") {
    signal("repeat");
    return;
  }
  // Nach der Sitzung: die eine Position nachholen, danach wieder abschliessen.
  if (state === "done" && lastRecorded) {
    const target = lastRecorded;
    state = "running";
    abortedReason = null;
    renderButtons();
    void setWakeLock(wakeWanted());
    void runSequence(target).then(endSession, (err: unknown) => {
      reportError(err);
      endSession();
    });
  }
});
btnAbort.addEventListener("click", () => abortRun("stopped-by-user"));
btnExport.addEventListener("click", () => void exportBundle());
btnAgain.addEventListener("click", () => {
  clips.clear();
  attemptsOf.clear();
  attemptLog = [];
  lastRecorded = null;
  enterReady();
});

initSettingsSheet(
  el<HTMLButtonElement>("btn-settings"),
  el<HTMLDialogElement>("settings"),
  el<HTMLButtonElement>("btn-settings-close"),
);

announceSelect.value = announceMode;
announceSelect.addEventListener("change", () => {
  announceMode = announceSelect.value as AnnounceMode;
  saveAnnounceMode(announceMode);
});

cameraSelect.addEventListener("change", () => void startCamera());
sizeSelect.addEventListener("change", () => {
  // Die Groesse ist hier die Kamerabetriebsart - sie wirkt erst mit dem
  // naechsten Oeffnen. Solange keine Sitzung laeuft, sofort neu verhandeln.
  if (camera && state !== "running") void startCamera();
});

initTheme(toggleLight, (light) => {
  lightMode = light;
  void setWakeLock(wakeWanted());
});

/**
 * Verschwindet die Seite waehrend eines Clips, verstummt die Sprachausgabe und
 * die Kamera kann einfrieren. Der laufende Clip wird deshalb verworfen; die
 * Position wird danach wiederholt.
 */
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden") return;
  if (state === "running" && phase === "clip") requestDiscard("page-hidden");
});
watchVisibility(wakeWanted);

window.addEventListener("pagehide", () => {
  runner?.abort();
  stopClipFrames?.();
  activeRecorder?.discard();
  voice?.close();
  if (camera) closeCamera(camera);
});

function buildLocaleSelect(): void {
  localeSelect.replaceChildren(
    ...LOCALES.map((locale) => {
      const option = document.createElement("option");
      option.value = locale;
      option.textContent = LOCALE_NAMES[locale];
      option.selected = locale === getLocale();
      return option;
    }),
  );
}

localeSelect.addEventListener("change", () => setLocale(localeSelect.value as Locale));

onLocaleChange(() => {
  applyTranslations(document, "app.plainTitle");
  renderSideMarks();
  renderButtons();
  btnStart.textContent = camera ? t("btn.switch") : t("btn.start");
  if (state === "idle") setStatus(t("basic.statusReady"));
  if (state === "ready") enterReady();
});

initLocale();
buildLocaleSelect();
applyTranslations(document, "app.plainTitle");
renderSideMarks();
renderButtons();
setStatus(t("basic.statusReady"));
