import { FaceLandmarker, FilesetResolver, type FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import type { Blendshapes, Landmark } from "../types";

/** Wraps the MediaPipe FaceLandmarker (478 landmarks, incl. iris). */

/** Written by scripts/fetch-assets.mjs into models/version.json. */
export interface ModelInfo {
  model: string;
  variant: string;
  version: string;
  source: string;
  fetched: string;
}

const WASM_PATH = `${import.meta.env.BASE_URL}mediapipe/wasm`;
const MODEL_PATH = `${import.meta.env.BASE_URL}mediapipe/models/face_landmarker.task`;
const VERSION_PATH = `${import.meta.env.BASE_URL}mediapipe/models/version.json`;

export class Landmarker {
  private constructor(
    private readonly inner: FaceLandmarker,
    readonly modelInfo: ModelInfo,
  ) {}

  static async create(): Promise<Landmarker> {
    // All three resources are local: no request leaves the page after load.
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    const inner = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" },
      runningMode: "VIDEO",
      numFaces: 2, // not 1, so a second face in frame is noticed
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    const modelInfo = (await (await fetch(VERSION_PATH)).json()) as ModelInfo;
    return new Landmarker(inner, modelInfo);
  }

  /**
   * Analyses one frame. `timestampMs` must increase strictly.
   *
   * Takes a canvas as well: analysis runs on a downscaled copy, capture on the
   * full video frame.
   */
  detect(frame: HTMLVideoElement | HTMLCanvasElement, timestampMs: number): FaceLandmarkerResult {
    return this.inner.detectForVideo(frame, timestampMs);
  }

  close(): void {
    this.inner.close();
  }
}

/** MediaPipe category list to a lookup table. */
export function toBlendshapeMap(result: FaceLandmarkerResult): Blendshapes | null {
  const categories = result.faceBlendshapes?.[0]?.categories;
  if (!categories) return null;
  const map: Record<string, number> = {};
  for (const c of categories) {
    if (c.categoryName) map[c.categoryName] = c.score;
  }
  return map;
}

/** Landmarks of the first (largest) face. */
export function firstFaceLandmarks(result: FaceLandmarkerResult): readonly Landmark[] | null {
  return result.faceLandmarks?.[0] ?? null;
}

/** Row-major 4x4 transformation matrix of the first face. */
export function firstFaceMatrix(result: FaceLandmarkerResult): readonly number[] | null {
  return result.facialTransformationMatrixes?.[0]?.data ?? null;
}
