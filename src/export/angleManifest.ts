import type { CameraProbe } from "../capture/capabilities";
import type { ModelInfo } from "../vision/landmarker";
import type { Landmark } from "../types";
import type { AngleAnalysis, PairSet } from "../vision/angleMap";
import { ANGLE_MAP_MAX_DEG, PAIR_COUNT, pairRegionCounts } from "../vision/angleMap";
import { MESH_PAIRS, MESH_PAIRS_VERSION, MIDLINE_FIT, PAIR_REGIONS } from "../vision/meshPairs";
import { collectDeviceInfo, round } from "./manifest";
import { cameraBlock, type CameraBlockInput } from "./videoManifest";
import type { Locale } from "../i18n";

/**
 * Manifest und Tabellen der Winkelkarten-Seite.
 *
 * Neben den Ergebniszahlen steht die Methode so weit drin, dass ein Leser sie
 * ohne den Code nachrechnen kann - Achsenpunkte, Paarliste, Winkelformel,
 * Vorzeichen. Die rohen Landmarks liegen je Aufnahme in einer eigenen Datei:
 * Wer die 91 Paare des Papers spaeter in der Hand hat, rechnet damit neu,
 * ohne die Person noch einmal zu brauchen.
 */

export const ANGLE_MANIFEST_VERSION = 1;

export interface AngleCapture {
  /** Positions-ID oder Dateiname. */
  id: string;
  index: number;
  slug: string;
  /** Englisches Label (Manifest) und angezeigtes Label. */
  label: string;
  labelShown: string;
  /** Rohe Landmarks (normiert), wie das Modell sie lieferte. */
  landmarks: readonly Landmark[];
  /** Groesse des analysierten Bildes, auf das sich `aligned` bezieht. */
  analysisWidth: number;
  analysisHeight: number;
  analysis: AngleAnalysis;
  faces: number;
  /** Foto in Kameraaufloesung - nur bei Kameraaufnahmen. */
  still: { blob: Blob; width: number; height: number } | null;
  /** Bei Dateianalyse: der Dateiname der Quelle. */
  sourceFile: string | null;
  capturedAt: string;
}

export interface AngleManifestInput {
  locale: Locale;
  startedAt: string;
  endedAt: string;
  source: "camera" | "files";
  pairSet: PairSet;
  captures: readonly AngleCapture[];
  model: ModelInfo | null;
  camera: (CameraBlockInput & { maxEdge: number }) | null;
  cameraProbe: CameraProbe | null;
  captureEdge: number;
}

export function stillFileName(c: AngleCapture): string {
  return `${c.slug}.jpg`;
}
export function mapFileName(c: AngleCapture): string {
  return `${c.slug}_anglemap.png`;
}
export function landmarksFileName(c: AngleCapture): string {
  return `${c.slug}_landmarks.json`;
}

export function buildAngleManifest(input: AngleManifestInput): Record<string, unknown> {
  return {
    manifestVersion: ANGLE_MANIFEST_VERSION,
    profile: "angle-map",
    method: {
      name: "angle-map",
      reference:
        "Heinrich A, Volk GF, Dobel C, Guntinas-Lichius O. AI-Based Angle Map Analysis of Facial Asymmetry in Peripheral Facial Palsy. Bioengineering 2026;13(4):426. doi:10.3390/bioengineering13040426",
      description:
        "478 MediaPipe face landmarks per image. Facial midline fitted by least squares (x on y) through 20 central landmarks; all landmarks rotated about the midline centroid so the midline is vertical. For each left/right landmark pair the angle of the connecting line against the horizontal is taken; the score is the mean absolute angle over the pair set. Reference-free: no rest image is needed.",
      landmarks: 478,
      midlineFit: {
        indices: [...MIDLINE_FIT],
        method: "ordinary least squares, x regressed on y",
        tiltSign:
          "midlineTiltDeg is the corrective rotation that makes the midline vertical, clockwise-positive with y pointing down",
      },
      pairs: {
        count: PAIR_COUNT,
        table: MESH_PAIRS_VERSION,
        note: "Derived by mirroring MediaPipe's canonical face model plus five iris pairs; the 91-pair subset of the paper is unpublished and not reproduced here.",
        regionCounts: pairRegionCounts(),
        regionNote: "Regions are this tool's approximation (nearest MediaPipe contour on the canonical model), not the paper's assignment.",
      },
      angle: {
        formula: "atan2(yLeft - yRight, xLeft - xRight) in degrees after alignment, folded into (-90, 90]",
        sign: "positive when the person's left landmark lies lower than the right",
      },
      score: `mean of |angle| over the pair set '${input.pairSet}'`,
      colorScale: { minDeg: 0, maxDeg: ANGLE_MAP_MAX_DEG, from: "blue", to: "red" },
      /** Laengste Kante des Bildes, auf dem die Landmarks bestimmt wurden. */
      analysisEdge: input.captureEdge,
      pairSetUsed: input.pairSet,
    },
    session: {
      locale: input.locale,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      source: input.source,
      captures: input.captures.length,
    },
    model: input.model
      ? {
          name: input.model.model,
          variant: input.model.variant,
          version: input.model.version,
          runtime: "@mediapipe/tasks-vision",
        }
      : null,
    camera: input.camera
      ? { ...cameraBlock(input.camera), maxEdge: input.camera.maxEdge }
      : null,
    device: collectDeviceInfo(),
    files: {
      angles: "angles.csv",
      scores: "scores.csv",
      landmarks: "one JSON per capture, see captures[].landmarksFile",
    },
    captures: input.captures.map((c) => ({
      id: c.id,
      index: c.index,
      slug: c.slug,
      label: c.label,
      labelShown: c.labelShown,
      sourceFile: c.sourceFile,
      file: c.still ? stillFileName(c) : null,
      mapFile: mapFileName(c),
      landmarksFile: landmarksFileName(c),
      width: c.still?.width ?? c.analysisWidth,
      height: c.still?.height ?? c.analysisHeight,
      analysisWidth: c.analysisWidth,
      analysisHeight: c.analysisHeight,
      faces: c.faces,
      midlineTiltDeg: round(c.analysis.midlineTiltDeg, 2),
      scores: {
        all: round(c.analysis.scores.all, 3),
        regional: round(c.analysis.scores.regional, 3),
        eyes: round(c.analysis.scores.eyes, 3),
        nose: round(c.analysis.scores.nose, 3),
        mouth: round(c.analysis.scores.mouth, 3),
        other: round(c.analysis.scores.other, 3),
      },
      capturedAt: c.capturedAt,
    })),
  };
}

/** Langes Format: eine Zeile je Aufnahme und Paar. */
export function anglesCsv(captures: readonly AngleCapture[]): string {
  const lines = ["capture,pair,leftIndex,rightIndex,region,angleDeg"];
  for (const c of captures) {
    c.analysis.angles.forEach((angle, i) => {
      const [left, right] = MESH_PAIRS[i]!;
      lines.push(`${c.slug},${i},${left},${right},${PAIR_REGIONS[i]},${angle.toFixed(3)}`);
    });
  }
  return lines.join("\n") + "\n";
}

/** Eine Zeile je Aufnahme. */
export function scoresCsv(captures: readonly AngleCapture[]): string {
  const lines = [
    "capture,label,sourceFile,faces,midlineTiltDeg,scoreAll,scoreRegional,scoreEyes,scoreNose,scoreMouth,scoreOther",
  ];
  for (const c of captures) {
    const s = c.analysis.scores;
    lines.push(
      [
        c.slug,
        JSON.stringify(c.label),
        JSON.stringify(c.sourceFile ?? ""),
        c.faces,
        c.analysis.midlineTiltDeg.toFixed(2),
        s.all.toFixed(3),
        s.regional.toFixed(3),
        s.eyes.toFixed(3),
        s.nose.toFixed(3),
        s.mouth.toFixed(3),
        s.other.toFixed(3),
      ].join(","),
    );
  }
  return lines.join("\n") + "\n";
}

/** Rohe Landmarks einer Aufnahme, normiert wie vom Modell geliefert. */
export function landmarksJson(c: AngleCapture): string {
  return JSON.stringify(
    {
      capture: c.slug,
      analysisWidth: c.analysisWidth,
      analysisHeight: c.analysisHeight,
      coordinates: "normalised to the analysed image (0..1), z as delivered by MediaPipe",
      landmarks: c.landmarks.map((l) => [round(l.x, 6), round(l.y, 6), round(l.z, 6)]),
    },
    null,
    0,
  );
}
