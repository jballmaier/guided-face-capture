/** Shared types. What only one module needs stays in that module. */

/** A single landmark in normalised image coordinates (0..1). */
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

/** Blendshape scores as a lookup table, name -> score (0..1). */
export type Blendshapes = Readonly<Record<string, number>>;

/** Head pose in degrees. Sign convention: see pose.ts. */
export interface HeadPose {
  yaw: number;
  pitch: number;
  roll: number;
}

/** Image quality of the current frame, measured on the face crop. */
export interface FrameQuality {
  /** Variance of the Laplacian. High = sharp. Dimensionless. */
  sharpness: number;
  /** Mean brightness, 0..255. */
  luminance: number;
  /** Share of blown-out or crushed pixels, 0..1. */
  clipping: number;
  /** Eye distance as a share of frame width. The threshold hangs on this. */
  interocular: number;
  /** Same distance in pixels of the saved still. For the record, not a threshold. */
  interocularPx: number;
  /** Face centre in normalised coordinates. */
  centerX: number;
  centerY: number;
}

/** Result of one analysed frame. */
export interface FrameAnalysis {
  timestampMs: number;
  faceCount: number;
  landmarks: readonly Landmark[] | null;
  blendshapes: Blendshapes | null;
  pose: HeadPose | null;
  quality: FrameQuality | null;
}

/** A pair of left/right blendshapes. */
export interface BlendshapePair {
  left: string;
  right: string;
}
