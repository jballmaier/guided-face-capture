import { FaceLandmarker } from "@mediapipe/tasks-vision";

/**
 * Named face regions as landmark indices and connections.
 *
 * Taken from MediaPipe except for the nose. A hand-maintained index list would
 * go silently wrong when the mesh changes.
 */

export type RegionName = "eyes" | "brows" | "lips" | "nose" | "faceOval";

export interface Connection {
  start: number;
  end: number;
}

/**
 * MediaPipe has no connection set for the nose. These points are hand-picked
 * for highlighting only - nose wrinkling is measured via blendshapes.
 */
const NOSE_MIDLINE = [168, 6, 197, 195, 5, 4, 1, 2];
const NOSE_ALAE_RIGHT = [129, 98, 97];
const NOSE_ALAE_LEFT = [358, 327, 326];

function chain(indices: readonly number[]): Connection[] {
  const out: Connection[] = [];
  for (let i = 0; i + 1 < indices.length; i++) {
    out.push({ start: indices[i]!, end: indices[i + 1]! });
  }
  return out;
}

const NOSE_CONNECTIONS: Connection[] = [
  ...chain(NOSE_MIDLINE),
  ...chain(NOSE_ALAE_RIGHT),
  ...chain(NOSE_ALAE_LEFT),
];

/** Connections per region, built on first access. */
const connectionCache = new Map<RegionName, readonly Connection[]>();
const indexCache = new Map<RegionName, ReadonlySet<number>>();

function build(name: RegionName): readonly Connection[] {
  switch (name) {
    case "eyes":
      return [
        ...FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
        ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
        ...FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS,
        ...FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS,
      ];
    case "brows":
      return [
        ...FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW,
        ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
      ];
    case "lips":
      return [...FaceLandmarker.FACE_LANDMARKS_LIPS];
    case "nose":
      return NOSE_CONNECTIONS;
    case "faceOval":
      return [...FaceLandmarker.FACE_LANDMARKS_FACE_OVAL];
  }
}

export function regionConnections(name: RegionName): readonly Connection[] {
  let cached = connectionCache.get(name);
  if (!cached) {
    cached = build(name);
    connectionCache.set(name, cached);
  }
  return cached;
}

export function regionIndices(name: RegionName): ReadonlySet<number> {
  let cached = indexCache.get(name);
  if (!cached) {
    const set = new Set<number>();
    for (const c of regionConnections(name)) {
      set.add(c.start);
      set.add(c.end);
    }
    cached = set;
    indexCache.set(name, cached);
  }
  return cached;
}

/** Vereinigt mehrere Regionen zu einer Indexmenge. */
export function unionIndices(names: readonly RegionName[]): ReadonlySet<number> {
  if (names.length === 1) return regionIndices(names[0]!);
  const set = new Set<number>();
  for (const name of names) for (const i of regionIndices(name)) set.add(i);
  return set;
}

/** The full mesh, for wireframe display. */
export function tesselation(): readonly Connection[] {
  return FaceLandmarker.FACE_LANDMARKS_TESSELATION;
}
