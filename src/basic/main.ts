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
import { captureStill, type Still } from "../capture/stills";
import {
  boxInsideRect,
  cropOutputSize,
  cropRectFor,
  CROP_ASPECT,
  VIDEO_CROP_PAD,
  type CropRect,
  type FrameSize,
} from "../capture/cropRect";
import { CroppedRecorder } from "../capture/croppedRecorder";
import {
  AlignGate,
  collectIssues,
  FaceBoxBaseline,
  RestBaseline,
  type FaceBoxSnapshot,
  type RestSnapshot,
} from "../align/align";
import { Landmarker, firstFaceLandmarks, firstFaceMatrix } from "../vision/landmarker";
import { poseFromMatrix } from "../vision/pose";
import { measureQuality } from "../vision/quality";
import { faceMetrics } from "../vision/geometry";
import {
  POSITIONS,
  positionById,
  positionInstruction,
  positionLabel,
  type PositionId,
  type PositionSpec,
} from "../protocol/positions";
import {
  beginAnnouncement,
  buildPositionScript,
  CueRunner,
  loadAnnounceMode,
  saveAnnounceMode,
  type AnnounceMode,
  type CueStep,
} from "./cues";
import { Voice, type VoiceInfo } from "./voice";
import { initSettingsSheet } from "../ui/sheet";
import {
  buildVideoManifest,
  clipFileName,
  type ClipAttempt,
  type ClipResult,
  type FrameWatchReport,
  type FrameWatchSample,
  type FrameWatchState,
} from "../export/videoManifest";
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
 * Gefuehrte Aufnahme: ein Clip je Position.
 *
 * The detection runs at full rate while aligning the person and placing the
 * crop. During a clip it drops to a sparse watch that only asks whether the
 * face is still inside the frame.
 *
 * Each position is recorded on its own. The announcement runs *before* the
 * recording, so it may take as long as the voice needs without ending up in a
 * file, and the person starts the clip themselves - nobody is surprised by a
 * countdown. Which file shows which expression needs no schedule any more:
 * the clip is the position.
 */

type BasicState = "idle" | "aligning" | "framing" | "running" | "done";

/**
 * Feinzustand innerhalb einer laufenden Sitzung.
 *
 * Erst `clip` schreibt eine Datei. Eine eigene Ansage-Phase gibt es nicht
 * mehr: der Aufnahmeknopf ist sofort scharf, die Ansage laeuft nebenher und
 * wird vom Druck abgebrochen.
 */
type RunPhase = "armed" | "clip";

/** Was ein Knopfdruck der laufenden Folge mitteilen kann. */
type RunSignal = "clip" | "repeat" | "abort";

/**
 * Analyse und Aufnahme sind getrennt: die Erkennung rechnet auf einer
 * verkleinerten Kopie, aufgezeichnet wird der Ausschnitt in voller Groesse.
 */
const ANALYSIS_EDGE = 640;

/**
 * Mindestabstand zwischen zwei Erkennungen waehrend der Ausrichtung.
 *
 * Die Ausrichtung braucht keine dreissig Messungen je Sekunde: Das Haltefenster
 * laeuft ueber 1,2 Sekunden, und die geglaettete Ruhe-Baseline ist bei zwanzig
 * Proben je Sekunde nach rund zwei Dutzend Bildern eingeschwungen. Was hier
 * eingespart wird, bleibt fuer die Darstellung der Vorschau uebrig.
 */
const ALIGN_DETECT_MS = 50;
const RECORD_FPS = 30;
const STILL_QUALITY = 0.92;

/** Kommt in dieser Zeit kein Datenblock, traegt die Kette auf dem Geraet nicht. */
const CHUNK_WATCHDOG_MS = 2500;

/**
 * Rahmenwache waehrend eines Clips.
 *
 * Zweimal je Sekunde statt dreissigmal - genug, um zu merken, dass jemand aus
 * dem Bild wandert, und wenig genug, um die Aufnahme nicht zu stoeren.
 */
const WATCH_INTERVAL_MS = 500;
/** Erst nach zwei schlechten Proben handeln - eine einzelne ist Rauschen. */
const WATCH_WARN_SAMPLES = 2;

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Element #${id} fehlt im HTML`);
  return node as T;
};

const stage = el<HTMLElement>("stage");
const video = el<HTMLVideoElement>("preview");
let cropCanvas = el<HTMLCanvasElement>("crop");
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
const rateSelect = el<HTMLSelectElement>("rate-select");
const announceSelect = el<HTMLSelectElement>("announce-select");
const toggleLight = el<HTMLInputElement>("toggle-light");
const toggleFullFrame = el<HTMLInputElement>("toggle-fullframe");
const toggleAutoDiscard = el<HTMLInputElement>("toggle-autodiscard");
const btnStart = el<HTMLButtonElement>("btn-start");
const btnFrame = el<HTMLButtonElement>("btn-frame");
const btnGuide = el<HTMLButtonElement>("btn-guide");
const btnBack = el<HTMLButtonElement>("btn-back");
const btnClip = el<HTMLButtonElement>("btn-clip");
const btnRepeat = el<HTMLButtonElement>("btn-repeat");
const btnAbort = el<HTMLButtonElement>("btn-abort");
const btnExport = el<HTMLButtonElement>("btn-export");
const btnAgain = el<HTMLButtonElement>("btn-again");
const btnSettings = el<HTMLButtonElement>("btn-settings");
const status = el<HTMLElement>("status");

let state: BasicState = "idle";
let phase: RunPhase = "armed";
/** Gegen ueberlappende Oeffnungen - der Verlierer liesse sonst einen nie
 *  gestoppten Kamerastrom zurueck. */
let openingCamera = false;
let announceMode: AnnounceMode = loadAnnounceMode();
/** Modus der laufenden Sitzung - eingefroren, damit das Manifest nicht luegt,
 *  wenn der Regler nach der Sitzung umgestellt wird. */
let sessionAnnounce: AnnounceMode = announceMode;
let landmarker: Landmarker | null = null;
let camera: ActiveCamera | null = null;
let cameraProbe: CameraProbe | null = null;
let stopLoop: (() => void) | null = null;
let lastTimestamp = -1;
let lightMode = false;

const restBaseline = new RestBaseline();
const faceBoxBaseline = new FaceBoxBaseline();
const alignGate = new AlignGate();

/** Was beim Uebergang in die Rahmenkontrolle eingefroren wurde. */
let frozenRest: RestSnapshot | null = null;
let frozenBox: FaceBoxSnapshot | null = null;
let cropRect: CropRect | null = null;
let outputSize: FrameSize = { width: 0, height: 0 };
let sourceSize: FrameSize = { width: 0, height: 0 };
let restStill: Still | null = null;

let recorder: CroppedRecorder | null = null;
let runner: CueRunner | null = null;
let voice: Voice | null = null;
let sessionLocale: Locale = "en";
let sessionBitrate = 0;
let startedAt = "";
let endedAt = "";
let sessionWallStart = 0;
/** Beim Sitzungsende eingefroren - nicht erst beim Klick auf "Sichern". */
let sessionWallMs = 0;
let abortedReason: string | null = null;

/**
 * Die behaltenen Clips, je Position hoechstens einer.
 *
 * Eine Map, keine Liste: Wiederholen ersetzt den Eintrag, statt einen zweiten
 * danebenzulegen. Was verworfen wurde, steht im Versuchsprotokoll.
 */
const clips = new Map<PositionId, ClipResult>();
/** Versuche je Position, verworfene eingeschlossen - fuer die Nummerierung. */
const attemptsOf = new Map<PositionId, number>();
/** Alle Versuche in zeitlicher Reihenfolge. */
let attemptLog: ClipAttempt[] = [];
/** Wird das Muster "dreimal, je eine Sekunde" noch gesagt? Einmal je Sitzung. */
let patternSpoken = false;
/** Zuletzt gespeicherte Position - Ziel des Wiederholen-Knopfs. */
let lastRecorded: PositionId | null = null;
/** Ansage der laufenden Position, fuer das Manifest. */
let lastAnnouncement: { text: string; wallMs: number } | null = null;

/** Aufloesung eines Knopfdrucks, auf den die Folge gerade wartet. */
let pending: ((signal: RunSignal) => void) | null = null;
/** Grund, aus dem der laufende Clip verworfen werden soll. */
let discardRequested: string | null = null;

let watchSamples: FrameWatchSample[] = [];
let watchTimer: number | null = null;
let watchBad = 0;

/** Ausgehandelter Kameramodus, als Text - Bezugsgroesse fuer die Schleifenrate. */
let cameraLine = "";
/**
 * Zwei getrennte Raten, weil sie zwei verschiedene Fragen beantworten: Wie
 * viele Bilder die Kamera liefert, und wie oft davon erkannt wird.
 */
const videoFps = { last: 0, value: 0 };
const detectFps = { last: 0, value: 0 };
let lastDetectAt = 0;
let statusShownAt = 0;

function trackFps(counter: { last: number; value: number }, nowMs: number): void {
  const dt = nowMs - counter.last;
  counter.last = nowMs;
  if (dt > 0 && dt < 1000) counter.value = counter.value * 0.9 + (1000 / dt) * 0.1;
}

let exporting = false;
/** Was der Ton tatsaechlich konnte - geht so ins Manifest. */
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
  // Im Fertig-Zustand keinen Kamerawechsel anbieten: er wuerfe die Sitzung
  // weg, bevor sie gesichert ist. "Neue Aufnahme" ist der Weg.
  btnStart.hidden = running || state === "done";
  btnFrame.hidden = state !== "aligning";
  btnGuide.hidden = state !== "framing";
  btnBack.hidden = state !== "framing";
  btnClip.hidden = !running || phase !== "armed";
  // Wiederholen gilt, solange kein Clip laeuft - waehrend der Folge und am
  // Ende, wo nie mehr einer laeuft.
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

  // Waehrend der Sitzung darf nichts umgestellt werden, was ins Manifest
  // eingeht - die Sprache der Ansagen am wenigsten.
  const locked = running;
  localeSelect.disabled = locked;
  cameraSelect.disabled = locked || cameraSelect.options.length < 2;
  sizeSelect.disabled = locked;
  rateSelect.disabled = locked;
  announceSelect.disabled = locked;
  toggleFullFrame.disabled = locked;
  // Das Blatt ist modal und legte sich sonst mitten in der Aufnahme ueber
  // Anweisung und Stopp-Knopf.
  btnSettings.disabled = locked;
}

let hintsShown = "";

function renderHints(issues: string[], ok?: string): void {
  const items = issues.map((text) => ({ text, ok: false }));
  if (issues.length === 0 && ok) items.push({ text: ok, ok: true });

  // Nur anfassen, wenn sich wirklich etwas geaendert hat: der Aufbau der
  // Knoten je Bild kostet Layout-Arbeit in genau der Schleife, die fluessig
  // bleiben soll.
  const key = items.map((m) => `${m.ok ? "1" : "0"}${m.text}`).join("|");
  if (key === hintsShown) return;
  hintsShown = key;

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

/** Kopfzeile des Banners: welche Position, optional die Wiederholung. */
function promptHeading(spec: PositionSpec, extra?: string): string {
  const base = t("stage.step", { number: spec.index, count: POSITIONS.length });
  return extra ? `${base} - ${extra}` : base;
}

/** Bereitschaftsanzeige - der Knopf ist scharf, hier laeuft keine Aufnahme. */
function showPosition(spec: PositionSpec): void {
  prompt.hidden = false;
  progressFill.style.width = "0%";
  progressFill.classList.remove("ready");
  promptStep.textContent = promptHeading(spec);
  promptTitle.textContent = positionLabel(spec);
  promptInstruction.textContent = `${positionInstruction(spec)} — ${t("basic.armed")}`;
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
  // Ein zweiter Aufruf waehrend des Oeffnens verloere den Strom des ersten -
  // niemand stoppte ihn je, die Kamera-LED bliebe an.
  if (openingCamera) return;
  openingCamera = true;
  btnStart.disabled = true;
  try {
    if (!landmarker) {
      setStatus(t("status.loadingModel"));
      landmarker = await Landmarker.create();
    }
    setStatus(t("status.openingCamera"));

    releaseCamera();
    const deviceId = cameraSelect.value || undefined;
    // Hier wird Bewegung aufgezeichnet, nicht ein scharfes Einzelbild: die
    // Bildrate ist Bedingung, die Aufloesung nur Wunsch. Ohne das waehlt der
    // Browser die groesste Betriebsart - und die ist eine Fotobetriebsart.
    camera = await openCamera({
      ...(deviceId ? { deviceId } : {}),
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

    enterAligning();

    // Was die Kamera wirklich liefert. Ohne diese Zeile ist eine ruckelnde
    // Vorschau nicht von einer langsamen Erkennung zu unterscheiden.
    const settings = cameraProbe?.delivered ?? camera.settings;
    cameraLine = t("status.cameraOpen", {
      width: settings.width ?? 0,
      height: settings.height ?? 0,
      fps: Math.round(settings.frameRate ?? 0),
      label: camera.label,
    });
    setStatus(cameraLine);
  } catch (err) {
    reportError(err);
    // Ohne Kamera ist nichts auszurichten: zurueck auf Anfang statt einer
    // toten Buehne.
    if (!camera) {
      state = "idle";
      stageEmpty.hidden = false;
      renderButtons();
    }
  } finally {
    openingCamera = false;
    btnStart.disabled = false;
    btnStart.textContent = camera ? t("btn.switch") : t("btn.start");
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
  stopLoop?.();
  stopLoop = null;
  if (camera) closeCamera(camera);
  camera = null;
  cameraProbe = null;
  lastTimestamp = -1;
}

// ------------------------------------------------------------------ Zustaende

function enterAligning(): void {
  state = "aligning";
  stage.classList.remove("cropped");
  stageEmpty.hidden = true;
  prompt.hidden = true;
  btnFrame.disabled = true;
  restBaseline.reset();
  faceBoxBaseline.reset();
  alignGate.reset();
  frozenRest = null;
  frozenBox = null;
  cropRect = null;
  recorder?.discard();
  recorder = null;
  renderButtons();
  setStatus(t("basic.aligning"));
  void setWakeLock(wakeWanted());

  stopLoop?.();
  lastTimestamp = -1;
  stopLoop = startFrameLoop(video, onAlignFrame);
}

/**
 * Ausrichtung fertig: Baseline und Ausschnitt einfrieren, ein Standbild der
 * Ruhe in voller Aufloesung sichern - und die Erkennung von der vollen Rate
 * auf die Rahmenwache herunterfahren.
 */
async function enterFraming(): Promise<void> {
  const box = faceBoxBaseline.snapshot;
  if (!box || !camera) return;

  frozenRest = restBaseline.snapshot;
  frozenBox = box;

  sourceSize = { width: video.videoWidth, height: video.videoHeight };
  cropRect = cropRectFor(box, sourceSize, { pad: VIDEO_CROP_PAD, aspect: CROP_ASPECT });

  // Das Ruhe-Foto entsteht, solange das Gesicht nachweislich ruht und
  // ausgerichtet ist - danach gibt es keine Messung mehr, die das belegen
  // koennte.
  try {
    restStill = await captureStill(video, 0, { quality: STILL_QUALITY });
  } catch (err) {
    restStill = null;
    console.warn("Ruhe-Foto fehlgeschlagen", err);
  }

  stopLoop?.();
  stopLoop = null;

  state = "framing";
  buildRecorder(toggleFullFrame.checked);

  renderButtons();
  renderHints([], t("basic.framingHint"));

  // Vor der Aufnahme zeigen, ob gesprochen wird - eine fehlende Stimme faellt
  // sonst erst nach der halben Sitzung auf.
  const speech = Voice.describe(getLocale());
  const voiceLine = speech.available
    ? t("basic.voiceReady", { name: speech.name ?? "" })
    : t("basic.noVoice");

  setStatus(
    `${t("basic.framing", {
      w: outputSize.width,
      h: outputSize.height,
      sw: sourceSize.width,
      sh: sourceSize.height,
      // Vor der Aufnahme sichtbar, nicht erst hinterher im Manifest: Steht
      // hier nicht die verlangte Rate, hat die Kamera keine passende
      // Betriebsart - und zwoelf Clips spaeter ist es zu spaet dafuer.
      fps: Math.round(camera.track.getSettings().frameRate ?? 0),
    })} ${voiceLine} ${t("basic.soundHint")}`,
  );
  void setWakeLock(wakeWanted());
}

/**
 * Baut den Recorder fuer die ganze Sitzung.
 *
 * Eine Instanz fuer alle Clips: Canvas, Zeichenschleife und Vorschau bleiben
 * damit ueber die Positionen hinweg stehen, und nur die Aufzeichnung beginnt
 * je Clip von vorn.
 */
function buildRecorder(fullFrame: boolean): void {
  if (!cropRect) return;
  // Rueckfallweg: das ungeschnittene Kamerabild aufzeichnen. Das Rechteck
  // bleibt im Manifest, damit die Auswertung es anwenden kann.
  const rect: CropRect = fullFrame ? { x: 0, y: 0, w: 1, h: 1 } : cropRect;
  const maxEdge = Number.parseInt(sizeSelect.value, 10);
  outputSize = cropOutputSize(rect, sourceSize, maxEdge);
  sessionBitrate =
    bitrateFor(outputSize.width, outputSize.height, RECORD_FPS) *
    Number.parseInt(rateSelect.value, 10);

  recorder?.discard();
  recorder = new CroppedRecorder(video, rect, outputSize, {
    fps: RECORD_FPS,
    videoBitsPerSecond: sessionBitrate,
  });
  swapCanvas(recorder.canvas);
  recorder.startPreview();
  stage.classList.toggle("cropped", !fullFrame);
}

/**
 * Die Canvas des Recorders tritt an die Stelle der Vorschau-Canvas.
 *
 * Sie ist die Vorschau: was hier steht, wird aufgezeichnet - die einzige
 * Rueckmeldung, die es ohne mitlaufende Erkennung noch gibt. Die Referenz
 * wandert mit, sonst ginge der zweite Austausch ins Leere.
 */
function swapCanvas(canvas: HTMLCanvasElement): void {
  canvas.id = "crop";
  cropCanvas.replaceWith(canvas);
  cropCanvas = canvas;
}

// -------------------------------------------------------------------- Folge

/** Loest den Knopfdruck auf, auf den die Folge gerade wartet. */
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
  if (!recorder || !camera || !cropRect) return;

  // Ton synchron in der Geste freischalten - ein `await` davor verbraucht sie
  // auf iOS. Die Freigabe gilt danach fuer die ganze Sitzung; der alte
  // Klangkontext wird geschlossen, sonst sammeln sich mit jeder Sitzung
  // AudioContexte an, bis der Browser keinen mehr hergibt.
  sessionLocale = getLocale();
  sessionAnnounce = announceMode;
  voice?.close();
  voice = Voice.unlock(sessionLocale);
  voiceInfo = voice.info;
  voiceMode = voiceInfo.available && sessionAnnounce !== "tones" ? "speech+tones" : "tones";

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
    showPosition(spec);
    renderHints([]);
    setStatus(`${promptHeading(spec)}: ${positionLabel(spec)} - ${t("basic.armed")}`);

    voice?.tone("next");
    const announce = beginAnnouncement(voice, spec, sessionLocale, {
      mode: sessionAnnounce,
      sayPattern: !patternSpoken,
    });
    if (announce.spokePattern) patternSpoken = true;
    lastAnnouncement = announce.record;

    const go = await waitForSignal();
    // Was auch immer folgt - die Ansage endet, bevor etwas anderes beginnt.
    announce.stop();
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

/** Wohin ein Wiederholen-Wunsch springt: zur zuletzt gespeicherten Position. */
function repeatTarget(order: readonly PositionSpec[], current: number): number {
  if (!lastRecorded) return current;
  const at = order.findIndex((s) => s.id === lastRecorded);
  return at < 0 ? current : at;
}

/**
 * Nimmt einen Clip auf: Vorlauf, drei Wiederholungen, Nachlauf.
 *
 * Der Clip steht fuer sich - eigene Datei, eigene Zeitachse ab null. Geht das
 * Gesicht dabei aus dem Rahmen, wird er verworfen und die Position komplett
 * wiederholt: eine halb aufgenommene Bewegung ist keine Messung, und acht
 * Sekunden noch einmal sind billiger als ein unbrauchbarer Datensatz.
 */
async function recordClip(spec: PositionSpec): Promise<"kept" | "discarded" | "abort"> {
  if (!recorder || !cropRect || !voice) {
    // Muss als Abbruch sichtbar werden, nicht als still gelungene Sitzung.
    abortedReason ??= "no-camera";
    return "abort";
  }

  const attempt = (attemptsOf.get(spec.id) ?? 0) + 1;
  attemptsOf.set(spec.id, attempt);

  const clipStartedAt = new Date().toISOString();
  const clipEpochMs = Date.now();

  watchSamples = [];
  watchBad = 0;
  discardRequested = null;

  recorder.start();
  watchChunks();
  const faceAtStart = sampleFace(cropRect) === "inside";
  startFrameWatch(cropRect);

  runner = new CueRunner(buildPositionScript(spec), {
    voice,
    clock: () => recorder?.elapsedMs ?? 0,
    onStep: (step, at, total) => showStep(step, at, total),
  });

  const events = await runner.run();
  const faceAtEnd = sampleFace(cropRect) === "inside";
  stopFrameWatch();

  // Der Verwerfen-Wunsch zaehlt nur bis zum Ende des Taktes: verschwindet die
  // Seite erst waehrend des Stopps, ist der Clip laengst vollstaendig.
  const discarded = discardRequested;
  const captured = await recorder.stop();

  // Manche Encoder liefern alle Daten erst beim Stop (MP4 auf Chromium und
  // iOS) - eine leere Aufnahme faellt deshalb erst hier sicher auf.
  if (captured.recording.bytes === 0 && abortedReason === null && discarded === null) {
    abortedReason = "no-video-data";
  }
  const aborted = abortedReason !== null;

  attemptLog.push({
    id: spec.id,
    attempt,
    kept: !discarded && !aborted,
    discardReason: discarded ?? (aborted ? abortedReason : null),
    startedAtEpochMs: clipEpochMs,
    durationMs: captured.recording.durationMs,
  });

  if (aborted) return "abort";

  if (discarded) {
    renderHints([t("basic.discarded")]);
    voice.tone("warn");
    return "discarded";
  }

  clips.set(spec.id, {
    spec,
    captured,
    events,
    frameWatch: watchSummary(),
    faceInsideCrop: { atStart: faceAtStart, atEnd: faceAtEnd },
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
  stopFrameWatch();
  prompt.hidden = true;
  endedAt = new Date().toISOString();
  sessionWallMs = performance.now() - sessionWallStart;
  state = "done";
  renderButtons();
  void setWakeLock(wakeWanted());

  const kept = [...clips.values()];
  const recordedMs = kept.reduce((sum, c) => sum + c.captured.recording.durationMs, 0);
  const bytes = kept.reduce((sum, c) => sum + c.captured.recording.bytes, 0);
  const frames = kept.reduce((sum, c) => sum + c.captured.drawnFrames, 0);
  const fps = recordedMs > 0 ? (frames * 1000) / recordedMs : 0;

  let text = t("basic.savedSession", {
    clips: kept.length,
    total: (bytes / 1024 / 1024).toFixed(1),
    seconds: (recordedMs / 1000).toFixed(0),
    fps: fps.toFixed(0),
  });
  const discardedCount = attemptLog.filter((a) => !a.kept).length;
  if (discardedCount > 0) text += ` - ${t("basic.discardedCount", { count: discardedCount })}`;

  // Der Befund der Rahmenwache ueber alle behaltenen Clips: Ausreisser in
  // einem behaltenen Clip sind der Fall, den man am Ende sehen muss.
  const samples = kept.reduce((sum, c) => sum + (c.frameWatch?.samples ?? 0), 0);
  const bad = kept.reduce(
    (sum, c) => sum + (c.frameWatch?.outsideSamples ?? 0) + (c.frameWatch?.noFaceSamples ?? 0),
    0,
  );
  if (samples > 0 && bad > 0) {
    text += ` - ${t("basic.watchSummary", {
      seconds: ((bad * WATCH_INTERVAL_MS) / 1000).toFixed(1),
      percent: Math.round((bad / samples) * 100),
    })}`;
  } else if (samples > 0) {
    text += ` - ${t("basic.watchClean")}`;
  }
  if (abortedReason) text = `${t("basic.stopped")} ${text}`;
  setStatus(text, Boolean(abortedReason) || kept.length < POSITIONS.length);
  renderHints([]);
}

/**
 * Frueher Abbruch statt leerer Datei: liefert der Browser nach ein paar
 * Sekunden keinen Datenblock, traegt die Aufnahme auf diesem Geraet nicht.
 *
 * Nur fuer WebM: die MP4-Muxer von Chromium und iOS ignorieren die
 * Zeitscheibe und liefern alles erst beim Stop (gemessen 2026-08-30) - dort
 * beweist ein leerer Zwischenstand nichts, und der Wachhund braeche gesunde
 * Aufnahmen ab. Leere MP4-Aufnahmen faengt die Byte-Pruefung nach dem Stop.
 */
function watchChunks(): void {
  setTimeout(() => {
    if (state !== "running" || phase !== "clip" || !recorder) return;
    if (!recorder.mimeType.includes("webm")) return;
    if (recorder.chunkCount > 0) return;
    abortRun("no-video-data");
    setStatus(t("basic.noData"), true);
  }, CHUNK_WATCHDOG_MS);
}

function abortRun(reason: string): void {
  if (state !== "running") return;
  abortedReason = reason;
  runner?.abort();
  signal("abort");
}

// ------------------------------------------------------------- Rahmenwache

/**
 * Eine Probe der Rahmenwache.
 *
 * Bewusst dreiwertig: Ein Gesicht ausserhalb des Rahmens und gar kein Gesicht
 * sind verschiedene Befunde - das eine heisst "zu weit gerutscht", das andere
 * kann auch heissen, dass die Kamera nichts mehr liefert.
 */
function sampleFace(rect: CropRect): FrameWatchState | null {
  if (!landmarker || video.videoWidth === 0) return null;
  try {
    const now = performance.now();
    const timestamp = now <= lastTimestamp ? lastTimestamp + 1 : now;
    lastTimestamp = timestamp;
    const frame = analysisFrame();
    if (!frame) return null;
    const detection = landmarker.detect(frame, timestamp);
    const landmarks = firstFaceLandmarks(detection);
    if (!landmarks) return "no-face";
    const quality = measureQuality(frame, frame.width, frame.height, landmarks, video.videoWidth);
    if (!quality) return "no-face";
    const inside = boxInsideRect(
      {
        centerX: quality.centerX,
        centerY: quality.centerY,
        width: quality.boxWidth,
        height: quality.boxHeight,
      },
      rect,
    );
    return inside ? "inside" : "outside";
  } catch {
    return null;
  }
}

function startFrameWatch(rect: CropRect): void {
  stopFrameWatch();
  watchTimer = window.setInterval(() => {
    if (state !== "running" || phase !== "clip" || !recorder) return;
    const sample = sampleFace(rect);
    if (!sample) return;
    watchSamples.push({ t: Math.round(recorder.elapsedMs), state: sample });

    // Die Wache tickt ohnehin - der guenstigste Ort, um die tatsaechliche
    // Aufnahmerate zu zeigen. Sie haengt stark an der gewaehlten Videogroesse.
    if (recorder.elapsedMs > 1000) {
      const fps = (recorder.drawnFrames * 1000) / recorder.elapsedMs;
      setStatus(`${t("basic.recording")} · ${t("basic.recFps", { fps: fps.toFixed(0) })}`);
    }

    if (sample === "inside") {
      watchBad = 0;
      return;
    }

    watchBad += 1;
    if (watchBad === WATCH_WARN_SAMPLES) {
      renderHints([t(sample === "no-face" ? "basic.noFaceWatch" : "basic.outOfFrame")]);
      // Ton, weil bei geschlossenen Augen niemand den Bildschirm sieht.
      voice?.tone("warn");
      if (toggleAutoDiscard.checked) requestDiscard(sample);
    }
  }, WATCH_INTERVAL_MS);
}

function stopFrameWatch(): void {
  if (watchTimer !== null) window.clearInterval(watchTimer);
  watchTimer = null;
}

/** Bricht den laufenden Clip ab; die Position wird danach wiederholt. */
function requestDiscard(reason: string): void {
  if (phase !== "clip" || discardRequested) return;
  discardRequested = reason;
  runner?.abort();
}

/** Verdichtet die Proben zu dem, was die Auswertung wissen muss. */
function watchSummary(): FrameWatchReport {
  const total = watchSamples.length;
  const inside = watchSamples.filter((s) => s.state === "inside").length;
  const noFace = watchSamples.filter((s) => s.state === "no-face").length;

  let longest = 0;
  let run = 0;
  for (const s of watchSamples) {
    run = s.state === "inside" ? 0 : run + 1;
    if (run > longest) longest = run;
  }

  return {
    intervalMs: WATCH_INTERVAL_MS,
    samples: total,
    insideSamples: inside,
    outsideSamples: total - inside - noFace,
    noFaceSamples: noFace,
    longestOutsideMs: longest * WATCH_INTERVAL_MS,
    series: watchSamples,
  };
}

// -------------------------------------------------------------------- Frames

const analysisCanvas = document.createElement("canvas");
const analysisCtx = analysisCanvas.getContext("2d", { willReadFrequently: true });

function analysisFrame(): HTMLCanvasElement | null {
  if (!analysisCtx || video.videoWidth === 0) return null;
  const f = Math.min(1, ANALYSIS_EDGE / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(1, Math.round(video.videoWidth * f));
  const height = Math.max(1, Math.round(video.videoHeight * f));
  if (analysisCanvas.width !== width || analysisCanvas.height !== height) {
    analysisCanvas.width = width;
    analysisCanvas.height = height;
  }
  analysisCtx.drawImage(video, 0, 0, width, height);
  return analysisCanvas;
}

function onAlignFrame(nowMs: number): void {
  if (!landmarker || state !== "aligning") return;
  if (video.videoWidth === 0 || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

  // Jedes gelieferte Bild zaehlt, erkannt wird nur ein Teil davon.
  trackFps(videoFps, nowMs);
  if (nowMs - statusShownAt > 500) {
    statusShownAt = nowMs;
    setStatus(
      `${cameraLine} · ${t("basic.loopFps", {
        video: videoFps.value.toFixed(0),
        detect: detectFps.value.toFixed(0),
      })}`,
    );
  }
  if (nowMs - lastDetectAt < ALIGN_DETECT_MS) return;
  lastDetectAt = nowMs;
  trackFps(detectFps, nowMs);

  // MediaPipe verlangt streng steigende Zeitstempel.
  const timestamp = nowMs <= lastTimestamp ? lastTimestamp + 1 : nowMs;
  lastTimestamp = timestamp;

  const frame = analysisFrame();
  if (!frame) return;

  const detection = landmarker.detect(frame, timestamp);
  const landmarks = firstFaceLandmarks(detection);
  const matrix = firstFaceMatrix(detection);
  const pose = matrix ? poseFromMatrix(matrix) : null;
  const metrics = landmarks ? faceMetrics(landmarks) : null;
  const quality = landmarks
    ? measureQuality(frame, frame.width, frame.height, landmarks, video.videoWidth)
    : null;
  const faceCount = detection.faceLandmarks?.length ?? 0;

  // Die Ausrichtung gatet absolut gegen die Kameraachse - das begrenzt, wie
  // schief die eingefrorene Ruhe sitzen kann.
  const issues = collectIssues(faceCount, pose, quality, null);
  if (issues.length === 0 && pose && metrics && quality) {
    restBaseline.add(pose, metrics);
    faceBoxBaseline.add(quality);
  }

  const ready = alignGate.update(issues.length, nowMs) && faceBoxBaseline.snapshot !== null;
  btnFrame.disabled = !ready;
  renderHints(issues, ready ? t("basic.aligned") : undefined);
}

// -------------------------------------------------------------------- Export

async function exportBundle(): Promise<void> {
  if (clips.size === 0 || exporting || !cropRect) return;
  exporting = true;
  btnExport.disabled = true;
  // Waehrend des Packens nichts wegraeumen lassen: "Neue Aufnahme" mitten im
  // Export leerte die Clip-Liste unter dem laufenden Durchlauf.
  btnAgain.disabled = true;
  btnRepeat.disabled = true;
  try {
    setStatus(t("status.packing"));
    // Eingefrorener Stand - ein Klick waehrend des Packens aendert nicht
    // mehr, was ins Paket kommt.
    const snapshot = new Map(clips);
    const manifest = buildVideoManifest({
      locale: sessionLocale,
      startedAt,
      endedAt,
      wallMs: sessionWallMs,
      abortedReason,
      clips: snapshot,
      attempts: attemptLog,
      fullFrame: toggleFullFrame.checked,
      requestedFps: RECORD_FPS,
      videoBitsPerSecond: sessionBitrate,
      maxEdge: Number.parseInt(sizeSelect.value, 10),
      bitrateFactor: Number.parseInt(rateSelect.value, 10),
      rect: cropRect,
      source: sourceSize,
      output: outputSize,
      cameraSettings: camera?.track.getSettings() ?? {},
      cameraProbe,
      frameRateFloor: camera?.frameRateFloor ?? null,
      cameraLabel: camera?.label ?? "Kamera",
      isFrontFacing: camera?.isFrontFacing ?? false,
      analysisEdge: ANALYSIS_EDGE,
      rest: frozenRest,
      faceBox: frozenBox,
      restStill: restStill
        ? {
            file: "rest_full.jpg",
            width: restStill.width,
            height: restStill.height,
            bytes: restStill.blob.size,
          }
        : null,
      audio: { mode: voiceMode, speech: voiceInfo, announcements: sessionAnnounce },
      model: landmarker?.modelInfo ?? null,
    });

    const files: Record<string, Uint8Array | string | Blob> = {};
    // Die Blobs wandern unkopiert ins ZIP - siehe zipStore.ts.
    for (const clip of snapshot.values()) {
      files[clipFileName(clip.spec, clip.captured.recording.mimeType)] =
        clip.captured.recording.blob;
    }
    if (restStill) files["rest_full.jpg"] = restStill.blob;
    files["manifest.json"] = JSON.stringify(manifest, null, 2);
    files["README.txt"] = readme();

    const blob = await packZip(files);
    const stamp = startedAt.replace(/[:.]/g, "-").slice(0, 19);
    downloadBlob(blob, `guided-clips_${stamp}.zip`);

    setStatus(
      t("basic.savedZip", {
        clips: snapshot.size,
        total: (blob.size / 1024 / 1024).toFixed(1),
      }),
    );
  } catch (err) {
    reportError(err);
  } finally {
    exporting = false;
    btnExport.disabled = false;
    btnAgain.disabled = false;
    btnRepeat.disabled = false;
  }
}

function readme(): string {
  const l = sessionLocale;
  return [
    tIn(l, "videoBundle.title"),
    "===========================================",
    "",
    tIn(l, "videoBundle.intro"),
    "",
    tIn(l, "videoBundle.contents"),
    "------",
    `  ${tIn(l, "videoBundle.clips")}`,
    ...(restStill ? [`  ${tIn(l, "videoBundle.rest")}`] : []),
    `  ${tIn(l, "videoBundle.manifest")}`,
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

const wakeWanted = (): boolean => lightMode || state === "framing" || state === "running";

btnStart.addEventListener("click", () => void startCamera());
btnFrame.addEventListener("click", () => void enterFraming());
btnGuide.addEventListener("click", () => void startGuidance());
btnBack.addEventListener("click", () => {
  recorder?.discard();
  recorder = null;
  enterAligning();
});
btnClip.addEventListener("click", () => signal("clip"));
btnRepeat.addEventListener("click", () => {
  if (state === "running") {
    signal("repeat");
    return;
  }
  // Nach der Sitzung: die eine Position nachholen, danach wieder abschliessen.
  // Nur mit stehender Aufnahmekette - sonst endete der Versuch als Leerlauf.
  if (state === "done" && lastRecorded && recorder && camera) {
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
  restStill = null;
  clips.clear();
  attemptsOf.clear();
  attemptLog = [];
  lastRecorded = null;
  // Eine im Fertig-Zustand geaenderte Kamerawahl greift jetzt - waehrend die
  // Clips noch ungesichert waren, blieb sie absichtlich liegen.
  const activeDevice = camera?.settings.deviceId;
  if (cameraSelect.value !== "" && activeDevice !== undefined && cameraSelect.value !== activeDevice) {
    void startCamera();
  } else {
    enterAligning();
  }
});

// Im Fertig-Zustand nicht neu oeffnen: das wuerfe die Sitzung weg, bevor sie
// gesichert ist. Die Wahl bleibt stehen und greift bei "Neue Aufnahme".
cameraSelect.addEventListener("change", () => {
  if (state !== "done" && state !== "running") void startCamera();
});

initSettingsSheet(
  btnSettings,
  el<HTMLDialogElement>("settings"),
  el<HTMLButtonElement>("btn-settings-close"),
);

announceSelect.value = announceMode;
announceSelect.addEventListener("change", () => {
  announceMode = announceSelect.value as AnnounceMode;
  saveAnnounceMode(announceMode);
});

/**
 * Hell/dunkel folgt dem System, bis jemand den Schalter benutzt. Die helle
 * Ansicht leuchtet das Gesicht aus und haelt den Bildschirm wach.
 */
initTheme(toggleLight, (light) => {
  lightMode = light;
  void setWakeLock(wakeWanted());
});

toggleFullFrame.addEventListener("change", () => {
  if (state === "framing") buildRecorder(toggleFullFrame.checked);
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
  stopFrameWatch();
  runner?.abort();
  recorder?.discard();
  voice?.close();
  stopLoop?.();
  if (camera) closeCamera(camera);
  landmarker?.close();
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
  applyTranslations(document, "app.basicTitle");
  renderSideMarks();
  renderButtons();
  btnStart.textContent = camera ? t("btn.switch") : t("btn.start");
  if (state === "idle") setStatus(t("basic.statusReady"));
});

initLocale();
buildLocaleSelect();
applyTranslations(document, "app.basicTitle");
renderSideMarks();
renderButtons();
setStatus(t("basic.statusReady"));
