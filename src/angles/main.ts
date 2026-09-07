import "../ui/styles.css";
import {
  attachStream,
  closeCamera,
  listCameras,
  MAX_CAPTURE_EDGE,
  openCamera,
  startFrameLoop,
  type ActiveCamera,
} from "../capture/camera";
import { probeCamera, type CameraProbe } from "../capture/capabilities";
import { captureStill } from "../capture/stills";
import { Landmarker, firstFaceLandmarks } from "../vision/landmarker";
import {
  analyzeFace,
  pairIndicesFor,
  type AngleAnalysis,
  type PairSet,
} from "../vision/angleMap";
import { drawAngleMap, drawColorScale, renderAngleMapImage } from "../ui/angleOverlay";
import {
  EXPRESSION_SET_9,
  positionById,
  positionInstruction,
  positionLabel,
  positionLabelIn,
  positionSlug,
} from "../protocol/positions";
import {
  anglesCsv,
  buildAngleManifest,
  landmarksFileName,
  landmarksJson,
  mapFileName,
  scoresCsv,
  stillFileName,
  type AngleCapture,
} from "../export/angleManifest";
import { downloadBlob, packZip } from "../export/bundle";
import { renderReadout, type ReadoutRow } from "../ui/panel";
import { setWakeLock, watchVisibility } from "../ui/wakeLock";
import { initTheme } from "../ui/theme";
import { initSettingsSheet } from "../ui/sheet";
import type { Landmark } from "../types";
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
 * Winkelkarten-Seite: die Asymmetrie-Kette von Heinrich et al. (2026) am
 * lebenden Bild und auf Fotodateien.
 *
 * Live laeuft die Kette auf jedem Bild und malt die Karte auf die Vorschau -
 * die Person sieht, was gemessen wird. Aufgenommen wird je Ausdruck ein Foto
 * in Kameraaufloesung, die Landmarks dafuer kommen aus einer groesseren Kopie
 * als die Live-Analyse, weil die Winkel an der Praezision der Punkte haengen.
 * Dieselbe Kette laeuft ueber Bilddateien, damit sich der Weg an Fotos aus
 * der Klinik pruefen laesst, ohne dass jemand vor der Kamera sitzt.
 */

type AnglesState = "idle" | "live" | "running" | "done";

/** Live-Analyse klein und schnell, Aufnahme-Analyse so gross, wie es das Modell noch lohnt. */
const LIVE_EDGE = 640;
const CAPTURE_EDGE = 1600;
const OVERLAY_EDGE = 1280;
const MAP_IMAGE_SIZE = 1000;
const STILL_QUALITY = 0.92;
/** Mindestabstand zweier Live-Erkennungen. */
const LIVE_DETECT_MS = 50;

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Element #${id} fehlt im HTML`);
  return node as T;
};

const stage = el<HTMLElement>("stage");
const video = el<HTMLVideoElement>("preview");
const overlay = el<HTMLCanvasElement>("overlay");
const stageEmpty = el<HTMLElement>("stage-empty");
const hints = el<HTMLElement>("hints");
const prompt = el<HTMLElement>("prompt");
const promptStep = el<HTMLElement>("prompt-step");
const promptTitle = el<HTMLElement>("prompt-title");
const promptInstruction = el<HTMLElement>("prompt-instruction");
const progressFill = el<HTMLElement>("progress-fill");
const markLeft = el<HTMLElement>("mark-left");
const markRight = el<HTMLElement>("mark-right");
const readout = el<HTMLElement>("readout");
const scale = el<HTMLCanvasElement>("scale");
const posList = el<HTMLOListElement>("poslist");
const fileList = el<HTMLOListElement>("filelist");
const localeSelect = el<HTMLSelectElement>("locale-select");
const cameraSelect = el<HTMLSelectElement>("camera-select");
const sizeSelect = el<HTMLSelectElement>("size-select");
const pairSetSelect = el<HTMLSelectElement>("pairset-select");
const fileInput = el<HTMLInputElement>("file-input");
const toggleLight = el<HTMLInputElement>("toggle-light");
const btnStart = el<HTMLButtonElement>("btn-start");
const btnSequence = el<HTMLButtonElement>("btn-sequence");
const btnShutter = el<HTMLButtonElement>("btn-shutter");
const btnSkip = el<HTMLButtonElement>("btn-skip");
const btnFinish = el<HTMLButtonElement>("btn-finish");
const btnExport = el<HTMLButtonElement>("btn-export");
const btnAgain = el<HTMLButtonElement>("btn-again");
const btnSettings = el<HTMLButtonElement>("btn-settings");
const status = el<HTMLElement>("status");

let state: AnglesState = "idle";
let landmarker: Landmarker | null = null;
let camera: ActiveCamera | null = null;
let cameraProbe: CameraProbe | null = null;
let openedMaxEdge = 0;
let openingCamera = false;
let stopLoop: (() => void) | null = null;
let lastTimestamp = -1;
let lastDetectAt = 0;
let lightMode = false;
let pairSet: PairSet = "all";

/** Letzte Live-Analyse, fuer die Anzeige. */
let live: { analysis: AngleAnalysis; faces: number } | null = null;
let readoutShownAt = 0;

/** Position im Neuner-Ablauf. */
let step = 0;
const captures: AngleCapture[] = [];
let snapshots = 0;
let startedAt = "";
let endedAt = "";
let capturing = false;
let exporting = false;

const overlayCtx = overlay.getContext("2d");

function setStatus(text: string, bad = false): void {
  status.textContent = text;
  status.classList.toggle("bad", bad);
}

function reportError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  setStatus(t("status.error", { message }), true);
  console.error(err);
}

// -------------------------------------------------------------- Bildkopien

function scaledTo(width: number, height: number, edge: number): { width: number; height: number } {
  const f = Math.min(1, edge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * f)), height: Math.max(1, Math.round(height * f)) };
}

const liveCanvas = document.createElement("canvas");
const liveCtx = liveCanvas.getContext("2d", { willReadFrequently: true });
const captureCanvas = document.createElement("canvas");
const captureCtx = captureCanvas.getContext("2d", { willReadFrequently: true });

/** Zeichnet eine Quelle verkleinert in eine Canvas und gibt sie zurueck. */
function copyInto(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  width: number,
  height: number,
  edge: number,
): HTMLCanvasElement {
  const size = scaledTo(width, height, edge);
  if (canvas.width !== size.width || canvas.height !== size.height) {
    canvas.width = size.width;
    canvas.height = size.height;
  }
  ctx.drawImage(source, 0, 0, size.width, size.height);
  return canvas;
}

/** MediaPipe verlangt streng steigende Zeitstempel - auch ueber Kopien hinweg. */
function nextTimestamp(): number {
  const now = performance.now();
  lastTimestamp = now <= lastTimestamp ? lastTimestamp + 1 : now;
  return lastTimestamp;
}

async function ensureLandmarker(): Promise<Landmarker> {
  if (!landmarker) {
    setStatus(t("status.loadingModel"));
    landmarker = await Landmarker.create();
  }
  return landmarker;
}

// ------------------------------------------------------------------ Anzeige

function renderButtons(): void {
  const running = state === "running";
  btnStart.hidden = running || state === "done";
  btnSequence.hidden = state !== "live";
  btnShutter.hidden = state !== "live" && !running;
  btnSkip.hidden = !running;
  btnFinish.hidden = !running;
  btnExport.hidden = captures.length === 0 || running;
  btnAgain.hidden = state !== "done";
  markLeft.hidden = state === "idle";
  markRight.hidden = state === "idle";

  const locked = running;
  localeSelect.disabled = locked;
  cameraSelect.disabled = locked || cameraSelect.options.length < 2;
  sizeSelect.disabled = locked;
  pairSetSelect.disabled = locked;
  fileInput.disabled = locked;
  btnSettings.disabled = locked;
}

function renderHints(items: readonly { text: string; ok: boolean }[]): void {
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

function deg(value: number): string {
  return `${value.toFixed(2)}°`;
}

function renderLiveReadout(): void {
  const rows: ReadoutRow[] = [];
  if (!live) {
    rows.push({ term: t("debug.faces"), value: "0", state: "bad" });
  } else {
    const s = live.analysis.scores;
    const c = live.analysis.counts;
    rows.push(
      { term: t("debug.faces"), value: String(live.faces), state: live.faces === 1 ? "ok" : "bad" },
      { term: t("angles.tilt"), value: deg(live.analysis.midlineTiltDeg) },
      { term: `${t("angles.scoreAll")} (225)`, value: deg(s.all) },
      {
        term: `${t("angles.scoreRegional")} (${c.eyes + c.nose + c.mouth})`,
        value: deg(s.regional),
      },
      { term: `${t("angles.eyes")} (${c.eyes})`, value: deg(s.eyes) },
      { term: `${t("angles.nose")} (${c.nose})`, value: deg(s.nose) },
      { term: `${t("angles.mouth")} (${c.mouth})`, value: deg(s.mouth) },
      { term: `${t("angles.other")} (${c.other})`, value: deg(s.other) },
    );
  }
  renderReadout(readout, rows);
}

function scoreOf(capture: AngleCapture): number {
  return pairSet === "all" ? capture.analysis.scores.all : capture.analysis.scores.regional;
}

function renderLists(): void {
  const currentId = state === "running" ? EXPRESSION_SET_9[step] : null;
  posList.replaceChildren(
    ...EXPRESSION_SET_9.map((id, i) => {
      const spec = positionById(id);
      const capture = captures.find((c) => c.id === id);
      const li = document.createElement("li");
      li.classList.toggle("is-current", id === currentId);
      li.classList.toggle("is-done", capture !== undefined);
      const num = document.createElement("span");
      num.className = "num";
      num.textContent = String(i + 1);
      const label = document.createElement("span");
      label.textContent = positionLabel(spec);
      const mark = document.createElement("span");
      mark.className = "mark";
      mark.textContent = capture ? deg(scoreOf(capture)) : "–";
      li.append(num, label, mark);
      return li;
    }),
  );

  const files = captures.filter((c) => c.sourceFile !== null || c.id.startsWith("snapshot"));
  fileList.replaceChildren(
    ...files.map((c, i) => {
      const li = document.createElement("li");
      li.classList.add("is-done");
      const num = document.createElement("span");
      num.className = "num";
      num.textContent = String(i + 1);
      const label = document.createElement("span");
      label.textContent = c.labelShown;
      const mark = document.createElement("span");
      mark.className = "mark";
      mark.textContent = deg(scoreOf(c));
      li.append(num, label, mark);
      return li;
    }),
  );
}

function showStep(): void {
  const id = EXPRESSION_SET_9[step];
  if (!id) return;
  const spec = positionById(id);
  prompt.hidden = false;
  promptStep.textContent = t("stage.step", { number: step + 1, count: EXPRESSION_SET_9.length });
  promptTitle.textContent = positionLabel(spec);
  promptInstruction.textContent = positionInstruction(spec);
  progressFill.style.width = `${Math.round((step / EXPRESSION_SET_9.length) * 100)}%`;
  progressFill.classList.remove("ready");
  renderHints([{ text: t("angles.captureHint"), ok: true }]);
}

// ------------------------------------------------------------------- Kamera

async function startCamera(): Promise<void> {
  if (openingCamera) return;
  openingCamera = true;
  btnStart.disabled = true;
  try {
    await ensureLandmarker();
    setStatus(t("status.openingCamera"));
    releaseCamera();
    const deviceId = cameraSelect.value || undefined;
    openedMaxEdge = Number.parseInt(sizeSelect.value, 10);
    camera = await openCamera({ ...(deviceId ? { deviceId } : {}), maxEdge: openedMaxEdge });
    await attachStream(video, camera.stream);
    await fillCameraList(camera);

    stage.classList.toggle("mirrored", camera.isFrontFacing);
    renderSideMarks();

    try {
      cameraProbe = await probeCamera(camera.track);
    } catch {
      cameraProbe = null;
    }

    enterLive();
    const settings = cameraProbe?.delivered ?? camera.settings;
    setStatus(
      `${t("status.cameraOpen", {
        width: settings.width ?? 0,
        height: settings.height ?? 0,
        fps: Math.round(settings.frameRate ?? 0),
        label: camera.label,
      })} ${t("angles.live")}`,
    );
  } catch (err) {
    reportError(err);
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
  live = null;
}

function enterLive(): void {
  state = "live";
  stageEmpty.hidden = true;
  prompt.hidden = true;
  renderHints([]);
  renderButtons();
  renderLists();
  void setWakeLock(wakeWanted());
  stopLoop?.();
  stopLoop = startFrameLoop(video, onLiveFrame);
}

// ------------------------------------------------------------ Live-Schleife

function onLiveFrame(nowMs: number): void {
  if (!landmarker || !liveCtx || !overlayCtx) return;
  if (video.videoWidth === 0 || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
  if (nowMs - lastDetectAt < LIVE_DETECT_MS) return;
  lastDetectAt = nowMs;

  const frame = copyInto(liveCanvas, liveCtx, video, video.videoWidth, video.videoHeight, LIVE_EDGE);
  const result = landmarker.detect(frame, nextTimestamp());
  const landmarks = firstFaceLandmarks(result);
  const faces = result.faceLandmarks?.length ?? 0;

  const size = scaledTo(video.videoWidth, video.videoHeight, OVERLAY_EDGE);
  if (overlay.width !== size.width || overlay.height !== size.height) {
    overlay.width = size.width;
    overlay.height = size.height;
  }
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

  if (landmarks) {
    live = { analysis: analyzeFace(landmarks, frame.width, frame.height), faces };
    // Live liegen die Linien auf dem unausgerichteten Gesicht: dieselben
    // Punkte, dieselben Farben - nur nicht gedreht.
    const points = landmarks.map((l) => ({ x: l.x * overlay.width, y: l.y * overlay.height }));
    drawAngleMap(overlayCtx, points, live.analysis.angles, pairIndicesFor(pairSet), {
      lineWidth: Math.max(1, overlay.width / 640),
      pointRadius: 0,
      alpha: 0.85,
      midline: false,
    });
  } else {
    live = null;
  }

  if (nowMs - readoutShownAt > 200) {
    readoutShownAt = nowMs;
    renderLiveReadout();
  }
}

// ------------------------------------------------------------------ Aufnahme

/** Landmarks aus einer grossen Kopie - die Praezision der Winkel haengt daran. */
function detectOn(source: CanvasImageSource, width: number, height: number): {
  landmarks: readonly Landmark[] | null;
  faces: number;
  width: number;
  height: number;
} {
  if (!landmarker || !captureCtx) throw new Error(t("status.loadingModel"));
  const frame = copyInto(captureCanvas, captureCtx, source, width, height, CAPTURE_EDGE);
  const result = landmarker.detect(frame, nextTimestamp());
  return {
    landmarks: firstFaceLandmarks(result),
    faces: result.faceLandmarks?.length ?? 0,
    width: frame.width,
    height: frame.height,
  };
}

/** Foto plus Analyse der aktuellen Kamerabilds. */
async function captureFromCamera(id: string, label: string, labelShown: string, slug: string): Promise<boolean> {
  if (capturing || video.videoWidth === 0) return false;
  capturing = true;
  try {
    const detected = detectOn(video, video.videoWidth, video.videoHeight);
    if (!detected.landmarks) {
      renderHints([{ text: t("angles.noFace"), ok: false }]);
      return false;
    }
    const still = await captureStill(video, 0, { quality: STILL_QUALITY });
    const analysis = analyzeFace(detected.landmarks, detected.width, detected.height);
    captures.push({
      id,
      index: captures.length + 1,
      slug,
      label,
      labelShown,
      landmarks: detected.landmarks,
      analysisWidth: detected.width,
      analysisHeight: detected.height,
      analysis,
      faces: detected.faces,
      still: { blob: still.blob, width: still.width, height: still.height },
      sourceFile: null,
      capturedAt: new Date().toISOString(),
    });
    setStatus(t("angles.captured", { label: labelShown, score: scoreOf(captures[captures.length - 1]!).toFixed(2) }));
    renderLists();
    renderButtons();
    return true;
  } catch (err) {
    reportError(err);
    return false;
  } finally {
    capturing = false;
  }
}

/** Dieselbe Kette ueber Bilddateien - ein Gesicht je Bild. */
async function analyzeFiles(files: readonly File[]): Promise<void> {
  if (files.length === 0) return;
  try {
    await ensureLandmarker();
    let ok = 0;
    for (const file of files) {
      const bitmap = await createImageBitmap(file);
      try {
        const detected = detectOn(bitmap, bitmap.width, bitmap.height);
        if (!detected.landmarks) continue;
        ok += 1;
        const slug = `file_${String(captures.length + 1).padStart(2, "0")}_${file.name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]+/g, "_")}`;
        captures.push({
          id: `file:${file.name}`,
          index: captures.length + 1,
          slug,
          label: file.name,
          labelShown: file.name,
          landmarks: detected.landmarks,
          analysisWidth: detected.width,
          analysisHeight: detected.height,
          analysis: analyzeFace(detected.landmarks, detected.width, detected.height),
          faces: detected.faces,
          still: null,
          sourceFile: file.name,
          capturedAt: new Date().toISOString(),
        });
      } finally {
        bitmap.close();
      }
    }
    if (!startedAt) startedAt = new Date().toISOString();
    setStatus(t("angles.filesDone", { ok, total: files.length }), ok < files.length);
    renderLists();
    renderButtons();
  } catch (err) {
    reportError(err);
  }
}

// -------------------------------------------------------------------- Ablauf

function startSequence(): void {
  if (state !== "live") return;
  state = "running";
  step = 0;
  startedAt = startedAt || new Date().toISOString();
  renderButtons();
  showStep();
  renderLists();
  void setWakeLock(wakeWanted());
}

async function captureStep(): Promise<void> {
  const id = EXPRESSION_SET_9[step];
  if (!id) return;
  const spec = positionById(id);
  const slug = `${String(step + 1).padStart(2, "0")}_${positionSlug(spec).replace(/^\d+_/, "")}`;
  const ok = await captureFromCamera(id, positionLabelIn("en", spec), positionLabel(spec), slug);
  if (ok) advance();
}

function advance(): void {
  step += 1;
  if (step >= EXPRESSION_SET_9.length) {
    finishSequence();
    return;
  }
  showStep();
  renderLists();
}

function finishSequence(): void {
  state = "done";
  endedAt = new Date().toISOString();
  prompt.hidden = true;
  renderHints([]);
  renderButtons();
  renderLists();
  setStatus(t("angles.sequenceDone", { count: captures.length }));
  void setWakeLock(wakeWanted());
}

/** Einzelaufnahme ausserhalb des Ablaufs - fuer schnelle Pruefungen. */
async function snapshot(): Promise<void> {
  snapshots += 1;
  const label = tIn("en", "angles.snapshot", { n: snapshots });
  if (!startedAt) startedAt = new Date().toISOString();
  await captureFromCamera(
    `snapshot-${snapshots}`,
    label,
    t("angles.snapshot", { n: snapshots }),
    `snapshot_${String(snapshots).padStart(2, "0")}`,
  );
}

// -------------------------------------------------------------------- Export

async function exportBundle(): Promise<void> {
  if (captures.length === 0 || exporting) return;
  exporting = true;
  btnExport.disabled = true;
  btnAgain.disabled = true;
  try {
    setStatus(t("status.packing"));
    const snapshotList = [...captures];
    const files: Record<string, Uint8Array | string | Blob> = {};
    for (const c of snapshotList) {
      if (c.still) files[stillFileName(c)] = c.still.blob;
      const map = renderAngleMapImage(c.analysis, pairIndicesFor(pairSet), MAP_IMAGE_SIZE);
      const png = await new Promise<Blob | null>((resolve) => map.toBlob(resolve, "image/png"));
      if (png) files[mapFileName(c)] = png;
      files[landmarksFileName(c)] = landmarksJson(c);
    }
    files["angles.csv"] = anglesCsv(snapshotList);
    files["scores.csv"] = scoresCsv(snapshotList);
    files["manifest.json"] = JSON.stringify(
      buildAngleManifest({
        locale: getLocale(),
        startedAt,
        endedAt: endedAt || new Date().toISOString(),
        source: snapshotList.some((c) => c.still) ? "camera" : "files",
        pairSet,
        captures: snapshotList,
        model: landmarker?.modelInfo ?? null,
        camera: camera
          ? {
              cameraLabel: camera.label,
              isFrontFacing: camera.isFrontFacing,
              cameraSettings: camera.track.getSettings(),
              cameraProbe,
              frameRateFloor: camera.frameRateFloor,
              maxEdge: openedMaxEdge > 0 ? openedMaxEdge : MAX_CAPTURE_EDGE,
            }
          : null,
        cameraProbe,
        captureEdge: CAPTURE_EDGE,
      }),
      null,
      2,
    );
    files["README.txt"] = readme();

    const blob = await packZip(files);
    const stamp = (startedAt || new Date().toISOString()).replace(/[:.]/g, "-").slice(0, 19);
    downloadBlob(blob, `angle-map_${stamp}.zip`);
    setStatus(t("angles.saved", { count: snapshotList.length, total: (blob.size / 1024 / 1024).toFixed(1) }));
  } catch (err) {
    reportError(err);
  } finally {
    exporting = false;
    btnExport.disabled = false;
    btnAgain.disabled = false;
  }
}

function readme(): string {
  const l = getLocale();
  return [
    tIn(l, "anglesBundle.title"),
    "===========================================",
    "",
    tIn(l, "anglesBundle.intro"),
    "",
    tIn(l, "videoBundle.contents"),
    "------",
    `  ${tIn(l, "anglesBundle.files")}`,
    `  ${tIn(l, "anglesBundle.tables")}`,
    `  ${tIn(l, "anglesBundle.manifest")}`,
    "",
    tIn(l, "bundle.prototype"),
    "",
  ].join("\n");
}

// -------------------------------------------------------------------- Events

const wakeWanted = (): boolean => lightMode || state === "live" || state === "running";

btnStart.addEventListener("click", () => void startCamera());
btnSequence.addEventListener("click", startSequence);
btnShutter.addEventListener("click", () => {
  if (state === "running") void captureStep();
  else if (state === "live") void snapshot();
});
btnSkip.addEventListener("click", advance);
btnFinish.addEventListener("click", finishSequence);
btnExport.addEventListener("click", () => void exportBundle());
btnAgain.addEventListener("click", () => {
  captures.length = 0;
  snapshots = 0;
  startedAt = "";
  endedAt = "";
  if (camera) enterLive();
  else {
    state = "idle";
    renderButtons();
    renderLists();
  }
});

initSettingsSheet(btnSettings, el<HTMLDialogElement>("settings"), el<HTMLButtonElement>("btn-settings-close"));

pairSetSelect.addEventListener("change", () => {
  pairSet = pairSetSelect.value as PairSet;
  renderLists();
});

fileInput.addEventListener("change", () => {
  const files = fileInput.files ? [...fileInput.files] : [];
  fileInput.value = "";
  el<HTMLDialogElement>("settings").close();
  void analyzeFiles(files);
});

// Nur im Live-Zustand sofort neu oeffnen - waehrend eines Ablaufs sind die
// Regler ohnehin gesperrt, im Fertig-Zustand greift die Wahl bei "Neu".
cameraSelect.addEventListener("change", () => {
  if (state === "live") void startCamera();
});
sizeSelect.addEventListener("change", () => {
  if (state === "live") void startCamera();
});

initTheme(toggleLight, (light) => {
  lightMode = light;
  void setWakeLock(wakeWanted());
});
watchVisibility(wakeWanted);

window.addEventListener("pagehide", () => {
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
  applyTranslations(document, "app.anglesTitle");
  renderSideMarks();
  renderButtons();
  renderLists();
  renderLiveReadout();
  btnStart.textContent = camera ? t("btn.switch") : t("btn.start");
  if (state === "idle") setStatus(t("angles.statusReady"));
  if (state === "running") showStep();
});

initLocale();
buildLocaleSelect();
applyTranslations(document, "app.anglesTitle");
drawColorScale(scale);
renderSideMarks();
renderButtons();
renderLists();
renderLiveReadout();
setStatus(t("angles.statusReady"));
