import "./ui/styles.css";
import {
  attachStream,
  closeCamera,
  listCameras,
  openCamera,
  startFrameLoop,
  type ActiveCamera,
} from "./capture/camera";
import {
  Landmarker,
  firstFaceLandmarks,
  firstFaceMatrix,
  toBlendshapeMap,
} from "./vision/landmarker";
import { poseFromMatrix, poseWithinTolerance, POSE_TOLERANCE } from "./vision/pose";
import { measureQuality, qualityIssues, issueText, QUALITY_THRESHOLDS } from "./vision/quality";
import { faceMetrics, type FaceMetrics } from "./vision/geometry";
import {
  POSITIONS,
  collectPairs,
  positionInstruction,
  positionLabel,
  type PositionId,
  type PositionSpec,
} from "./protocol/positions";
import type { DetectorSample } from "./protocol/detector";
import { CaptureSession, type PositionResult, type SessionResult } from "./session/session";
import { buildManifest } from "./export/manifest";
import { probeCamera, type CameraProbe } from "./capture/capabilities";
import { renderTuning, type TuningRow } from "./ui/tuning";
import {
  applyTranslations,
  getLocale,
  initLocale,
  LOCALES,
  LOCALE_NAMES,
  onLocaleChange,
  setLocale,
  t,
  type Locale,
} from "./i18n";
import {
  anyTuned,
  baseTuning,
  isTuned,
  resetTuning,
  setTuning,
  tuningAsCode,
  tuningOf,
  type TuningKey,
} from "./protocol/tuning";
import { buildBundle, downloadBlob } from "./export/bundle";
import { drawOverlay, highlightFor, type MeshMode } from "./ui/overlay";
import { StripChart } from "./ui/graph";
import { renderBars, renderReadout, renderSideCompare, type ReadoutRow, type SideEntry } from "./ui/panel";
import type { Blendshapes, FrameQuality, HeadPose } from "./types";

type AppState = "idle" | "aligning" | "running" | "review";

/** How long alignment must hold before recording is released. */
const ALIGN_HOLD_MS = 1200;

/**
 * Analysis and capture are separate.
 *
 * The camera runs at full resolution. Running MediaPipe on that per frame
 * collapses the loop for no gain: landmark detection needs a face a few
 * hundred pixels wide, not two thousand. It gets a downscaled copy while the
 * still comes from the full frame.
 *
 * Same for the overlay: a canvas at capture size costs width x height x 4
 * bytes and draws no point more precisely.
 */
const ANALYSIS_EDGE = 640;
const OVERLAY_EDGE = 1280;

/** Bits per pixel and second. A fixed bitrate would be the real quality loss
 *  at full resolution: a large frame the codec has nothing to fill it with. */
const BITS_PER_PIXEL = 0.07;
const MAX_BITRATE = 40_000_000;
const MIN_BITRATE = 2_000_000;

function bitrateFor(width: number, height: number, frameRate: number): number {
  const fps = frameRate > 0 ? frameRate : 30;
  const raw = Math.round(width * height * fps * BITS_PER_PIXEL);
  return Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, raw));
}

/** Groesse einer verkleinerten Kopie mit derselben Form. */
function scaledTo(width: number, height: number, edge: number): { width: number; height: number } {
  const f = Math.min(1, edge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * f)), height: Math.max(1, Math.round(height * f)) };
}

/** Downscaled copy of the current frame, for analysis. */
const analysisCanvas = document.createElement("canvas");
const analysisCtx = analysisCanvas.getContext("2d", { willReadFrequently: true });

function analysisFrame(source: HTMLVideoElement): HTMLCanvasElement | null {
  if (!analysisCtx) return null;
  const size = scaledTo(source.videoWidth, source.videoHeight, ANALYSIS_EDGE);
  if (analysisCanvas.width !== size.width || analysisCanvas.height !== size.height) {
    analysisCanvas.width = size.width;
    analysisCanvas.height = size.height;
  }
  analysisCtx.drawImage(source, 0, 0, size.width, size.height);
  return analysisCanvas;
}

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Element #${id} fehlt im HTML`);
  return node as T;
};

const stage = el<HTMLElement>("stage");
const video = el<HTMLVideoElement>("preview");
const overlay = el<HTMLCanvasElement>("overlay");
const stageEmpty = el<HTMLElement>("stage-empty");
const anonBadge = el<HTMLElement>("anon-badge");
const hints = el<HTMLElement>("hints");
const prompt = el<HTMLElement>("prompt");
const promptStep = el<HTMLElement>("prompt-step");
const promptTitle = el<HTMLElement>("prompt-title");
const promptInstruction = el<HTMLElement>("prompt-instruction");
const progressFill = el<HTMLElement>("progress-fill");
const review = el<HTMLElement>("review");
const reviewGrid = el<HTMLElement>("review-grid");
const reviewNote = el<HTMLElement>("review-note");
const posList = el<HTMLOListElement>("poslist");
const readout = el<HTMLElement>("readout");
const cameraReadout = el<HTMLElement>("camera-readout");
const tuneList = el<HTMLElement>("tunelist");
const localeSelect = el<HTMLSelectElement>("locale-select");
const markLeft = el<HTMLElement>("mark-left");
const markRight = el<HTMLElement>("mark-right");
const tunedBadge = el<HTMLElement>("tuned-badge");
const btnTuningCopy = el<HTMLButtonElement>("btn-tuning-copy");
const btnTuningReset = el<HTMLButtonElement>("btn-tuning-reset");
const bars = el<HTMLElement>("bars");
const sideCompare = el<HTMLElement>("sidecompare");
const graphCanvas = el<HTMLCanvasElement>("graph");
const graphCaption = el<HTMLElement>("graph-caption");
const tabDebug = el<HTMLElement>("tab-debug");
const btnStart = el<HTMLButtonElement>("btn-start");
const btnRun = el<HTMLButtonElement>("btn-run");
const btnShutter = el<HTMLButtonElement>("btn-shutter");
const btnSkip = el<HTMLButtonElement>("btn-skip");
const btnExport = el<HTMLButtonElement>("btn-export");
const cameraSelect = el<HTMLSelectElement>("camera-select");
const fileInput = el<HTMLInputElement>("file-input");
const meshSelect = el<HTMLSelectElement>("mesh-mode");
const toggleAnon = el<HTMLInputElement>("toggle-anon");
const toggleLight = el<HTMLInputElement>("toggle-light");
const status = el<HTMLElement>("status");

const ctx = overlay.getContext("2d");
if (!ctx) throw new Error("2D-Kontext fuer das Overlay nicht verfuegbar");

const chart = new StripChart(graphCanvas, {
  windowMs: 6000,
  series: [
    { key: "drive", label: t("debug.drive"), color: "#5b8dd6" },
    { key: "suppress", label: t("debug.suppress"), color: "#d4614f" },
  ],
});

let landmarker: Landmarker | null = null;
let camera: ActiveCamera | null = null;
let stream: MediaStream | null = null;
let session: CaptureSession | null = null;
let sessionResult: SessionResult | null = null;
let state: AppState = "idle";
let stopLoop: (() => void) | null = null;
let lastTimestamp = -1;
let alignOkSince: number | null = null;
let lastSample: DetectorSample | null = null;
let cameraProbe: CameraProbe | null = null;
let sessionBitrate = 0;
/** Position the threshold list was last drawn for. Rebuilt only on change,
 *  so fields do not vanish while being typed into. */
let tuningRenderedFor: string | null = null;
let finishing = false;
const objectUrls: string[] = [];

/** View toggles. Visual only - they do not touch the recording. */
const view = {
  mesh: "points" as MeshMode,
  anonymous: false,
  light: false,
};

const fps = { last: 0, value: 0 };

function setStatus(text: string, bad = false): void {
  status.textContent = text;
  status.classList.toggle("bad", bad);
}

// ------------------------------------------------------------- Bildschirm

/**
 * Bildschirmsperre.
 *
 * Without it the screen light is gone after the usual timeout - exactly when
 * the person holds still and touches nothing.
 */
interface WakeLockLike {
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
}

let wakeLock: WakeLockLike | null = null;

async function updateWakeLock(): Promise<void> {
  const wanted = view.light || state === "running";
  const api = (
    navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLockLike> } }
  ).wakeLock;
  if (!api) return;

  if (wanted && !wakeLock) {
    try {
      wakeLock = await api.request("screen");
      wakeLock.addEventListener("release", () => {
        wakeLock = null;
      });
    } catch {
      // No reason to fail the recording over this.
    }
  } else if (!wanted && wakeLock) {
    const held = wakeLock;
    wakeLock = null;
    void held.release().catch(() => undefined);
  }
}

// ---------------------------------------------------------------- Quellen

async function ensureLandmarker(): Promise<Landmarker> {
  if (!landmarker) {
    setStatus(t("status.loadingModel"));
    landmarker = await Landmarker.create();
  }
  return landmarker;
}

async function startCamera(): Promise<void> {
  btnStart.disabled = true;
  try {
    await ensureLandmarker();
    setStatus(t("status.openingCamera"));

    releaseSource();
    const deviceId = cameraSelect.value || undefined;
    camera = await openCamera(deviceId ? { deviceId } : {});
    stream = camera.stream;
    video.loop = false;
    await attachStream(video, camera.stream);
    await fillCameraList(camera);

    stage.classList.toggle("mirrored", camera.isFrontFacing);
    renderSideMarks();
    enterAligning();

    // One query per opened camera. A failure must not break opening.
    try {
      cameraProbe = await probeCamera(camera.track);
    } catch (err) {
      console.warn("Kamerafaehigkeiten nicht abfragbar", err);
      cameraProbe = null;
    }
    renderCameraPanel();

    // From the probe, not from the values noted on open: on iOS the reported
    // size settles shortly after start, with the edges swapped before that.
    const { width, height, frameRate } = cameraProbe?.delivered ?? camera.settings;
    setStatus(
      t("status.cameraOpen", {
        width: width ?? 0,
        height: height ?? 0,
        fps: Math.round(frameRate ?? 0),
        label: camera.label,
      }),
    );
  } catch (err) {
    reportError(err);
  } finally {
    btnStart.disabled = false;
    btnStart.textContent = t("btn.switch");
  }
}

/**
 * Development path: the same detection chain against a video file. The only
 * way to check thresholds reproducibly.
 */
async function useFile(file: File): Promise<void> {
  try {
    await ensureLandmarker();
    releaseSource();

    const url = URL.createObjectURL(file);
    objectUrls.push(url);
    video.srcObject = null;
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.loop = true;
    await video.play();

    const capture = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream;
    stream = typeof capture === "function" ? capture.call(video) : null;
    camera = null;

    stage.classList.remove("mirrored");
    renderSideMarks();
    enterAligning();
    setStatus(
      stream
        ? t("status.file", { name: file.name })
        : `Datei: ${file.name} – nur Analyse, dieser Browser kann den Dateistream nicht aufzeichnen`,
      !stream,
    );
  } catch (err) {
    reportError(err);
  }
}

function releaseSource(): void {
  stopLoop?.();
  stopLoop = null;
  if (camera) closeCamera(camera);
  camera = null;
  stream = null;
  lastTimestamp = -1;
  cameraProbe = null;
  renderReadout(cameraReadout, cameraRows(null));
}

/**
 * Camera capabilities for the panel.
 *
 * The interesting row is not the resolution but the factor: how many pixels
 * the device offers beyond the delivered stream.
 */
/**
 * L/R markers on the preview, as on a radiograph.
 *
 * They name the side of the person. The preview is mirrored for the front
 * camera, so the person's right is then on the right of the screen and the
 * letters swap with it. The saved image carries its own markers - it is never
 * mirrored, so they do not agree with the preview, and that is the point.
 */
function renderSideMarks(): void {
  const mirrored = stage.classList.contains("mirrored");
  markLeft.textContent = t(mirrored ? "side.left" : "side.right");
  markRight.textContent = t(mirrored ? "side.right" : "side.left");
}

function renderCameraPanel(): void {
  renderReadout(cameraReadout, cameraRows(cameraProbe));
}

function cameraRows(probe: CameraProbe | null): ReadoutRow[] {
  if (!probe) return [{ term: t("camera.heading"), value: t("camera.none") }];

  const size = (w: number | null, h: number | null): string => (w && h ? `${w}×${h}` : "—");
  const times = (f: number | null): string => (f ? `×${f.toFixed(1)}` : "—");

  const rows: ReadoutRow[] = [
    { term: t("camera.source"), value: probe.label },
    {
      term: t("camera.delivered"),
      value: `${size(probe.delivered.width, probe.delivered.height)}${
        probe.delivered.frameRate ? ` @ ${Math.round(probe.delivered.frameRate)} fps` : ""
      }`,
    },
  ];

  // crop-and-scale means a downscale nobody asked for sits between sensor
  // and image. That is the case worth seeing.
  if (probe.delivered.resizeMode) {
    rows.push({
      term: t("camera.resize"),
      value: probe.delivered.resizeMode,
      state: probe.delivered.resizeMode === "none" ? "ok" : "bad",
    });
  }

  if (probe.offered) {
    rows.push({
      term: t("camera.videoOffers"),
      value: `${size(probe.offered.maxWidth, probe.offered.maxHeight)} ${times(probe.videoFactor)}`,
      state: probe.videoFactor !== null && probe.videoFactor >= 1.5 ? "bad" : "ok",
    });
  } else {
    rows.push({ term: t("camera.videoOffers"), value: t("camera.videoUnknown") });
  }

  if (probe.photo.supported && probe.photo.maxWidth) {
    rows.push({
      term: t("camera.photoOffers"),
      value: `${size(probe.photo.maxWidth, probe.photo.maxHeight)} ${times(probe.photoFactor)}`,
      state: probe.photoFactor !== null && probe.photoFactor >= 1.5 ? "bad" : "ok",
    });
  } else if (probe.photo.supported) {
    // Happens for sources that are not real cameras, e.g. a canvas stream.
    rows.push({ term: t("camera.photoLabel"), value: t("camera.photoNoSize") });
  } else {
    rows.push({ term: t("camera.photoLabel"), value: probe.photo.note ?? t("camera.photoMissing") });
  }

  return rows;
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

function reportError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  setStatus(t("status.error", { message }), true);
  console.error(err);
}

// -------------------------------------------------------------------- State

function enterAligning(): void {
  state = "aligning";
  session = null;
  sessionResult = null;
  finishing = false;
  alignOkSince = null;
  stageEmpty.hidden = true;
  review.hidden = true;
  prompt.hidden = true;
  btnRun.hidden = false;
  btnRun.disabled = true;
  btnShutter.hidden = true;
  btnSkip.hidden = true;
  btnExport.hidden = true;
  chart.clear();
  chart.setThreshold(null);
  graphCaption.textContent = t("debug.noPosition");
  renderPositionList();
  void updateWakeLock();

  stopLoop?.();
  lastTimestamp = -1;
  stopLoop = startFrameLoop(video, onFrame);
}

function startSequence(): void {
  if (!stream) {
    setStatus(t("status.noSource"), true);
    return;
  }
  try {
    // Read fresh: on iOS the reported size still changes shortly after start.
    const live = camera?.track.getSettings() ?? {};
    sessionBitrate = bitrateFor(
      video.videoWidth,
      video.videoHeight,
      live.frameRate ?? 30,
    );

    session = new CaptureSession(video, stream, {
      // Bitrate and still quality drive the storage footprint directly.
      videoBitsPerSecond: sessionBitrate,
      still: { quality: 0.92 },
    });
    session.start();
    state = "running";
    prompt.hidden = false;
    btnRun.hidden = true;
    btnShutter.hidden = false;
    btnSkip.hidden = false;
    chart.clear();
    setStatus(t("status.recording"));
    void updateWakeLock();
  } catch (err) {
    reportError(err);
  }
}

function enterReview(): void {
  state = "review";
  prompt.hidden = true;
  btnShutter.hidden = true;
  btnSkip.hidden = true;
  btnExport.hidden = false;
  review.hidden = false;
  chart.setThreshold(null);
  graphCaption.textContent = t("debug.sequenceDone");
  renderReview();
  void updateWakeLock();
}

// ------------------------------------------------------------------- Frames

function onFrame(nowMs: number): void {
  if (!landmarker) return;
  if (video.videoWidth === 0 || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

  // MediaPipe requires strictly increasing timestamps; a repeated value
  // throws instead of skipping the frame.
  const timestamp = nowMs <= lastTimestamp ? lastTimestamp + 1 : nowMs;
  lastTimestamp = timestamp;

  const overlaySize = scaledTo(video.videoWidth, video.videoHeight, OVERLAY_EDGE);
  if (overlay.width !== overlaySize.width || overlay.height !== overlaySize.height) {
    overlay.width = overlaySize.width;
    overlay.height = overlaySize.height;
  }

  const frame = analysisFrame(video);
  if (!frame) return;

  const result = landmarker.detect(frame, timestamp);
  const landmarks = firstFaceLandmarks(result);
  const blendshapes = toBlendshapeMap(result);
  const matrix = firstFaceMatrix(result);
  const pose = matrix ? poseFromMatrix(matrix) : null;
  const metrics = landmarks ? faceMetrics(landmarks) : null;
  // Measured on the copy, reported in pixels of the saved image - hence the
  // capture width as the reference.
  const quality = landmarks
    ? measureQuality(frame, frame.width, frame.height, landmarks, video.videoWidth)
    : null;
  const faceCount = result.faceLandmarks?.length ?? 0;

  lastSample =
    blendshapes && metrics && pose && quality
      ? { timestampMs: timestamp, blendshapes, metrics, pose, quality, faceCount }
      : null;

  const activeSpec = state === "running" ? (session?.currentSpec ?? null) : null;

  drawOverlay(ctx!, overlay.width, overlay.height, {
    landmarks,
    meshMode: view.mesh,
    highlight: highlightFor(activeSpec?.id ?? null),
    anonymous: view.anonymous,
    light: view.light,
    guide: state !== "review",
  });

  const issues = collectIssues(faceCount, pose, quality);

  if (state === "aligning") {
    handleAligning(issues, nowMs);
    renderHints(issues);
  } else if (state === "running" && session) {
    const sessionView = session.update(lastSample, nowMs);
    renderPrompt(sessionView.spec, sessionView.positionNumber, sessionView.positionCount, sessionView.progress, sessionView.phase);
    renderHints(sessionView.phase === "measure" ? issues : []);
    renderPositionList();
    if ((sessionView.spec?.id ?? null) !== tuningRenderedFor) renderTuningPanel();

    if (sessionView.spec) {
      chart.setThreshold(sessionView.spec.minDrive);
      graphCaption.textContent = `- ${positionLabel(sessionView.spec)}`;
    }
    if (sessionView.reading) {
      chart.push(nowMs, {
        drive: sessionView.reading.drive,
        suppress: sessionView.reading.suppress,
      });
    }
    if (sessionView.phase === "review" && !finishing) enterReview();
  } else {
    renderHints([]);
  }

  // The panel costs DOM work per frame - render only while visible.
  if (!tabDebug.hidden) {
    chart.setTheme(view.light);
    chart.render(nowMs);
    renderReadout(readout, readoutRows(faceCount, pose, quality, metrics, activeSpec));
    renderSideCompare(sideCompare, sideEntries(activeSpec, blendshapes, metrics));
    renderBars(bars, blendshapes, 10);
  }

  const dt = nowMs - fps.last;
  fps.last = nowMs;
  if (dt > 0) fps.value = fps.value * 0.9 + (1000 / dt) * 0.1;
}

function collectIssues(faceCount: number, pose: HeadPose | null, quality: FrameQuality | null): string[] {
  if (faceCount === 0) return [issueText("no-face")];
  if (faceCount > 1) return [issueText("multiple-faces")];
  const out = quality ? qualityIssues(quality).map(issueText) : [];
  if (pose && !poseWithinTolerance(pose, POSE_TOLERANCE)) out.push(issueText("head-tilted"));
  return out;
}

function handleAligning(issues: string[], nowMs: number): void {
  if (issues.length > 0) {
    alignOkSince = null;
    btnRun.disabled = true;
    return;
  }
  alignOkSince ??= nowMs;
  btnRun.disabled = nowMs - alignOkSince < ALIGN_HOLD_MS;
}

// ----------------------------------------------------------------- Rendering

function renderHints(issues: string[]): void {
  const items = issues.map((t) => ({ text: t, ok: false }));
  if (state === "aligning" && issues.length === 0) {
    items.push({ text: "Ausrichtung in Ordnung", ok: true });
  }
  hints.replaceChildren(
    ...items.map((m) => {
      const div = document.createElement("div");
      div.className = `hint ${m.ok ? "ok" : "bad"}`;
      div.textContent = m.text;
      return div;
    }),
  );
}

function renderPrompt(
  spec: PositionSpec | null,
  number: number,
  count: number,
  progress: number,
  phase: string,
): void {
  if (!spec) return;
  promptStep.textContent = t("stage.step", { number, count });
  promptTitle.textContent = positionLabel(spec);
  promptInstruction.textContent =
    phase === "prepare"
      ? t("stage.soon", { instruction: positionInstruction(spec) })
      : positionInstruction(spec);
  progressFill.style.width = `${Math.round(progress * 100)}%`;
  progressFill.classList.toggle("ready", phase === "confirm");
}

function readoutRows(
  faceCount: number,
  pose: HeadPose | null,
  quality: FrameQuality | null,
  metrics: FaceMetrics | null,
  spec: PositionSpec | null,
): ReadoutRow[] {
  const rows: ReadoutRow[] = [
    { term: t("debug.analysis"), value: `${fps.value.toFixed(0)} fps` },
    { term: t("debug.faces"), value: String(faceCount), state: faceCount === 1 ? "ok" : "bad" },
  ];

  if (pose) {
    const angle = (v: number, tol: number): "ok" | "bad" => (Math.abs(v) <= tol ? "ok" : "bad");
    const fmt = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}°`;
    rows.push(
      { term: "Yaw", value: fmt(pose.yaw), state: angle(pose.yaw, POSE_TOLERANCE.yaw) },
      { term: "Pitch", value: fmt(pose.pitch), state: angle(pose.pitch, POSE_TOLERANCE.pitch) },
      { term: "Roll", value: fmt(pose.roll), state: angle(pose.roll, POSE_TOLERANCE.roll) },
    );
  }

  if (quality) {
    rows.push(
      {
        term: t("debug.sharpness"),
        value: quality.sharpness.toFixed(0),
        state: quality.sharpness >= QUALITY_THRESHOLDS.minSharpness ? "ok" : "bad",
      },
      { term: t("debug.luminance"), value: quality.luminance.toFixed(0) },
      {
        term: t("debug.clipping"),
        value: `${(quality.clipping * 100).toFixed(1)} %`,
        state: quality.clipping <= QUALITY_THRESHOLDS.maxClipping ? "ok" : "bad",
      },
      {
        // Both numbers: the share decides, the pixels say how finely the face
        // is resolved in the saved image.
        term: t("debug.interocular"),
        value: `${quality.interocularPx.toFixed(0)} px · ${(quality.interocular * 100).toFixed(1)} %`,
        state: quality.interocular >= QUALITY_THRESHOLDS.minInterocular ? "ok" : "bad",
      },
    );
  }

  if (metrics) {
    rows.push({ term: t("debug.interlabial"), value: metrics.interlabialGap.toFixed(3) });
  }
  if (spec) {
    rows.push({ term: t("debug.position"), value: positionLabel(spec) });
  }
  return rows;
}

/** Label of a blendshape pair without the side suffix. */
function pairLabel(left: string, right: string): string {
  const strip = (s: string) => s.replace(/(Left|Right)$/, "");
  const a = strip(left);
  return a === strip(right) ? a : `${left} / ${right}`;
}

function sideEntries(
  spec: PositionSpec | null,
  blendshapes: Blendshapes | null,
  metrics: FaceMetrics | null,
): SideEntry[] {
  if (!spec || !blendshapes) return [];

  const pairs = [...collectPairs(spec.drive), ...(spec.suppress ? collectPairs(spec.suppress) : [])];
  const seen = new Set<string>();
  const entries: SideEntry[] = [];

  for (const p of pairs) {
    const label = pairLabel(p.left, p.right);
    if (seen.has(label)) continue;
    seen.add(label);
    entries.push({ label, left: blendshapes[p.left] ?? 0, right: blendshapes[p.right] ?? 0 });
  }

  // Geometric per-side measures fill in where the blendshapes say nothing.
  if (metrics) {
    const regions = highlightFor(spec.id);
    if (regions.includes("eyes")) {
      // With lagophthalmos the blendshape of the affected side sits near
      // zero; only the measured eyelid gap still says anything.
      entries.push({
        label: t("debug.eyeOpening"),
        left: metrics.eyeOpeningLeft,
        right: metrics.eyeOpeningRight,
        scale: 0.25,
      });
    }
    if (regions.includes("lips")) {
      // The only per-side signal for lip pursing: mouthPucker and
      // mouthFunnel are unpaired.
      entries.push({
        label: t("debug.philtrum"),
        left: metrics.philtrumToCornerLeft,
        right: metrics.philtrumToCornerRight,
        scale: 0.8,
      });
    }
  }

  return entries;
}

function renderTuningPanel(): void {
  const currentId = session?.currentSpec?.id ?? null;
  tuningRenderedFor = currentId;

  const rows: TuningRow[] = POSITIONS.map((spec) => ({
    spec,
    values: tuningOf(spec),
    base: baseTuning(spec),
    changed: isTuned(spec),
    isCurrent: spec.id === currentId && state === "running",
  }));

  renderTuning(tuneList, rows, {
    onChange(spec, key: TuningKey, value) {
      setTuning(spec, key, value);
      // The running position must measure with the new value at once.
      session?.retuneCurrent();
      afterTuningChange();
    },
    onReset(spec) {
      resetTuning(spec);
      session?.retuneCurrent();
      afterTuningChange();
    },
  });

  tunedBadge.hidden = !anyTuned();
}

function afterTuningChange(): void {
  renderTuningPanel();
  renderPositionList();
}

function renderPositionList(): void {
  const results = session?.allResults ?? null;
  const currentId = session?.currentSpec?.id ?? null;

  posList.replaceChildren(
    ...POSITIONS.map((spec) => {
      const result = results?.find((r) => r.spec.id === spec.id) ?? null;
      const li = document.createElement("li");
      const done = Boolean(result?.still);
      const missing = Boolean(
        result && !result.still && (result.timedOut || result.attempts > 0) && spec.id !== currentId,
      );
      li.classList.toggle("is-current", spec.id === currentId && state === "running");
      li.classList.toggle("is-done", done);
      li.classList.toggle("is-missing", missing && !done);

      const num = document.createElement("span");
      num.className = "num";
      num.textContent = String(spec.index);

      const label = document.createElement("span");
      label.textContent = positionLabel(spec);

      const mark = document.createElement("span");
      mark.className = "mark";
      mark.textContent = done ? "✓" : missing ? "—" : "";

      li.append(num, label, mark);
      return li;
    }),
  );
}

function renderReview(): void {
  const results = session?.allResults ?? [];
  const captured = results.filter((r) => r.still).length;
  reviewNote.textContent =
    `${captured} von ${results.length} Positionen aufgenommen. ` +
    t("review.note");

  for (const url of objectUrls.splice(0)) URL.revokeObjectURL(url);
  reviewGrid.replaceChildren(...results.map(reviewCard));
}

function reviewCard(result: PositionResult): HTMLElement {
  const card = document.createElement("div");
  card.className = "card";

  if (!result.still) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = t("review.none");
    card.append(empty);
  } else if (view.anonymous) {
    // Anonymous mode has to apply here too, or the review shows the faces
    // the interface just promised to hide.
    const hidden = document.createElement("div");
    hidden.className = "empty anon";
    hidden.textContent = t("review.hidden");
    card.append(hidden);
  } else {
    const url = URL.createObjectURL(result.still.blob);
    objectUrls.push(url);
    const img = document.createElement("img");
    img.src = url;
    img.alt = positionLabel(result.spec);
    // Shows the saved, unmirrored image exactly as exported. No CSS flip.
    card.append(img);
  }

  const body = document.createElement("div");
  body.className = "card-body";

  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = `${result.spec.index}. ${positionLabel(result.spec)}`;

  const meta = document.createElement("div");
  meta.className = "card-meta";
  const badge = document.createElement("span");
  if (result.triggered) {
    badge.className = "badge auto";
    badge.textContent = t("review.auto");
  } else if (result.capturedManually) {
    badge.className = "badge manual";
    badge.textContent = t("review.manual");
  } else {
    badge.className = "badge timeout";
    badge.textContent = t("review.timeout");
  }
  meta.append(badge);
  if (result.apex) {
    meta.append(
      document.createTextNode(
        ` · Auslenkung ${result.apex.drive.toFixed(2)} · ${(result.apex.atMs / 1000).toFixed(1)} s`,
      ),
    );
  }

  const redo = document.createElement("button");
  redo.className = "ghost";
  redo.type = "button";
  redo.textContent = t("review.redo");
  redo.addEventListener("click", () => redoPosition(result.spec.id));

  body.append(title, meta, redo);
  card.append(body);
  return card;
}

function redoPosition(id: PositionId): void {
  if (!session) return;
  session.redo(id);
  state = "running";
  review.hidden = true;
  prompt.hidden = false;
  btnShutter.hidden = false;
  btnSkip.hidden = false;
  btnExport.hidden = true;
  chart.clear();
  setStatus(t("status.repeat"));
  void updateWakeLock();
}

// ------------------------------------------------------------------- Export

async function exportBundle(): Promise<void> {
  if (!session || !landmarker || finishing) return;
  finishing = true;
  btnExport.disabled = true;
  try {
    setStatus(t("status.finishing"));
    sessionResult ??= await session.finish();

    const manifest = buildManifest({
      session: sessionResult,
      // Not the values noted on open: on iOS width and height are swapped
      // there, because the report settles only after start.
      cameraSettings: camera?.track.getSettings() ?? {},
      cameraProbe,
      analysis: { edge: ANALYSIS_EDGE },
      videoBitsPerSecond: sessionBitrate,
      cameraLabel: camera?.label ?? "Videodatei",
      isFrontFacing: camera?.isFrontFacing ?? false,
      model: landmarker.modelInfo,
      mirrorApplied: false,
    });

    setStatus(t("status.packing"));
    const blob = await buildBundle({ session: sessionResult, manifest });
    const stamp = sessionResult.startedAt.replace(/[:.]/g, "-").slice(0, 19);
    downloadBlob(blob, `face-capture_${stamp}.zip`);

    const mb = (blob.size / 1024 / 1024).toFixed(1);
    const videoMb = (sessionResult.recording.bytes / 1024 / 1024).toFixed(1);
    setStatus(
      `Gespeichert: ${mb} MB gesamt, davon ${videoMb} MB Video (${(sessionResult.durationMs / 1000).toFixed(0)} s)`,
    );
    void updateWakeLock();
  } catch (err) {
    reportError(err);
  } finally {
    btnExport.disabled = false;
  }
}

// ------------------------------------------------------------------- Events

btnStart.addEventListener("click", () => void startCamera());
btnRun.addEventListener("click", () => startSequence());
btnShutter.addEventListener("click", () => void session?.captureManually(lastSample));
btnSkip.addEventListener("click", () => session?.skip());
btnExport.addEventListener("click", () => void exportBundle());

cameraSelect.addEventListener("change", () => void startCamera());
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) void useFile(file);
});

meshSelect.addEventListener("change", () => {
  view.mesh = meshSelect.value as MeshMode;
});

toggleAnon.addEventListener("change", () => {
  view.anonymous = toggleAnon.checked;
  stage.classList.toggle("anonymous", view.anonymous);
  anonBadge.hidden = !view.anonymous;
  // Force the mesh on: an anonymous view without points is a blank area.
  if (view.anonymous && view.mesh === "off") {
    view.mesh = "points";
    meshSelect.value = "points";
  }
  if (state === "review") renderReview();
});

toggleLight.addEventListener("change", () => {
  view.light = toggleLight.checked;
  document.body.classList.toggle("lightmode", view.light);
  void updateWakeLock();
});

// The wake lock is dropped when the tab goes to the background - reacquire.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void updateWakeLock();
});

for (const tab of document.querySelectorAll<HTMLButtonElement>(".tab")) {
  tab.addEventListener("click", () => {
    for (const other of document.querySelectorAll(".tab")) other.classList.remove("is-active");
    tab.classList.add("is-active");
    const wanted = tab.dataset["tab"];
    el("tab-positions").hidden = wanted !== "positions";
    el("tab-tuning").hidden = wanted !== "tuning";
    tabDebug.hidden = wanted !== "debug";
  });
}

window.addEventListener("pagehide", () => {
  stopLoop?.();
  session?.abort();
  if (camera) closeCamera(camera);
  for (const url of objectUrls) URL.revokeObjectURL(url);
});

btnTuningCopy.addEventListener("click", () => {
  const text = tuningAsCode();
  void navigator.clipboard
    ?.writeText(text)
    .then(() => setStatus(t("tuning.copied")))
    .catch(() => {
      // Without clipboard permission the console is the fallback.
      console.log(text);
      setStatus(t("tuning.copyFailed"), true);
    });
});

btnTuningReset.addEventListener("click", () => {
  resetTuning();
  session?.retuneCurrent();
  afterTuningChange();
  setStatus(t("tuning.resetDone"));
});

/**
 * Language selector, listed in each language's own name so it can be found
 * from any starting language. A switch redraws everything carrying text.
 */
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

function retranslate(): void {
  applyTranslations();
  renderPositionList();
  renderTuningPanel();
  renderCameraPanel();
  renderSideMarks();
  if (state === "idle") setStatus(t("status.ready", { count: POSITIONS.length }));
  btnStart.textContent = camera ? t("btn.switch") : t("btn.start");
}

localeSelect.addEventListener("change", () => {
  setLocale(localeSelect.value as Locale);
});

onLocaleChange(retranslate);

initLocale();
buildLocaleSelect();
applyTranslations();

renderPositionList();
renderTuningPanel();
renderSideMarks();
renderSideCompare(sideCompare, []);
renderReadout(cameraReadout, cameraRows(null));
setStatus(t("status.ready", { count: POSITIONS.length }));
