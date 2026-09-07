/**
 * Leitet die Links-rechts-Paare des MediaPipe-Gesichtsnetzes ab und schreibt
 * sie nach src/vision/meshPairs.ts.
 *
 * Grundlage ist das kanonische Gesichtsmodell aus dem MediaPipe-Repo
 * (468 Vertices, Apache 2.0). Es ist spiegelsymmetrisch zur Ebene x = 0:
 * Jeder Punkt abseits der Mittellinie hat genau einen Spiegelpartner, und die
 * 28 Punkte auf der Mittellinie bilden die Symmetrieachse. Dazu kommen die
 * fuenf Irispunkte je Auge (Indizes 468-477), die das Modell nicht enthaelt.
 * Ergebnis: 220 + 5 = 225 Paare - die Zahl, mit der Heinrich et al.
 * (Bioengineering 2026, 13:426) arbeiten.
 *
 *   node scripts/build-mesh-pairs.mjs [pfad/zur/canonical_face_model.obj]
 *
 * Ohne Pfad wird das Modell aus dem MediaPipe-Repo geladen.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL_URL =
  "https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/mediapipe/modules/face_geometry/data/canonical_face_model.obj";

/** Index des aeusseren linken Augenwinkels laut FaceLandmarker.FACE_LANDMARKS_LEFT_EYE. */
const LEFT_EYE_OUTER = 263;

/**
 * Die acht Lippenpunkte der Mittellinie. Heinrich et al. schaetzen die
 * Mittellinie aus 20 zentralen Punkten, "ohne acht Mundpunkte" - die
 * Lippen bewegen sich bei den Uebungen und wuerden die Achse verziehen.
 */
const LIP_MIDLINE = [0, 11, 12, 13, 14, 15, 16, 17];

/**
 * Konturen aus MediaPipes face_mesh_connections (Python-Paket), als
 * Indexmengen. Dienen hier nur der Regionszuordnung der Paare.
 */
const EYES = [
  263, 249, 390, 373, 374, 380, 381, 382, 362, 466, 388, 387, 386, 385, 384, 398,
  33, 7, 163, 144, 145, 153, 154, 155, 133, 246, 161, 160, 159, 158, 157, 173,
];
const BROWS = [276, 283, 282, 295, 285, 300, 293, 334, 296, 336, 46, 53, 52, 65, 55, 70, 63, 105, 66, 107];
const LIPS = [
  61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 185, 40, 39, 37, 0, 267, 269, 270, 409,
  78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 191, 80, 81, 82, 13, 312, 311, 310, 415,
];
const NOSE = [168, 6, 197, 195, 5, 4, 1, 19, 94, 2, 98, 97, 326, 327, 294, 278, 344, 440, 275, 45, 220, 115, 48, 64];

/**
 * Irispaare (person-links, person-rechts). MediaPipe legt die Ringpunkte je
 * Iris in Bildkoordinaten als rechts/oben/links/unten ab: rechte Iris
 * 468 Mitte, 469-472 Ring; linke Iris 473 Mitte, 474-477 Ring. Gespiegelt
 * entsprechen sich Mitte, oben, unten sowie lateral und medial.
 */
const IRIS_PAIRS = [
  [473, 468],
  [475, 470],
  [477, 472],
  [474, 471],
  [476, 469],
];

async function loadModel(path) {
  if (path) return readFile(path, "utf8");
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`Modell-Download fehlgeschlagen: HTTP ${res.status}`);
  return res.text();
}

function parseVertices(text) {
  const vertices = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("v ")) continue;
    const [, x, y, z] = line.trim().split(/\s+/);
    vertices.push({ x: Number(x), y: Number(y), z: Number(z) });
  }
  return vertices;
}

async function main() {
  const text = await loadModel(process.argv[2]);
  const vertices = parseVertices(text);
  if (vertices.length !== 468) throw new Error(`468 Vertices erwartet, ${vertices.length} gefunden`);
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 12);

  const leftSign = Math.sign(vertices[LEFT_EYE_OUTER].x);
  if (leftSign === 0) throw new Error("Vertex 263 liegt auf der Mittellinie - Seitenzuordnung unmoeglich");

  const midline = [];
  const left = [];
  const right = [];
  vertices.forEach((v, i) => {
    if (Math.abs(v.x) < 1e-6) midline.push(i);
    else if (Math.sign(v.x) === leftSign) left.push(i);
    else right.push(i);
  });
  if (midline.length !== 28) throw new Error(`28 Mittellinienpunkte erwartet, ${midline.length} gefunden`);
  for (const lip of LIP_MIDLINE) {
    if (!midline.includes(lip)) throw new Error(`Lippenpunkt ${lip} liegt nicht auf der Mittellinie`);
  }

  // Spiegelpartner: der rechte Punkt, der dem gespiegelten linken am naechsten
  // liegt. Die Zuordnung muss eindeutig sein, sonst stimmt das Modell nicht.
  const used = new Set();
  const pairs = [];
  let worst = 0;
  for (const l of left) {
    const m = vertices[l];
    let best = -1, bestDist = Infinity;
    for (const r of right) {
      const v = vertices[r];
      const d = Math.hypot(v.x + m.x, v.y - m.y, v.z - m.z);
      if (d < bestDist) { bestDist = d; best = r; }
    }
    if (bestDist > 1e-3) throw new Error(`Kein Spiegelpartner fuer ${l} (Abstand ${bestDist})`);
    if (used.has(best)) throw new Error(`Rechter Punkt ${best} doppelt zugeordnet`);
    used.add(best);
    worst = Math.max(worst, bestDist);
    pairs.push([l, best]);
  }
  if (pairs.length !== 220) throw new Error(`220 Paare erwartet, ${pairs.length} gefunden`);
  pairs.sort((a, b) => a[0] - b[0]);

  // Regionen: jeder Punkt gehoert zur naechstgelegenen MediaPipe-Kontur
  // (Augen samt Brauen, Nase, Lippen), sofern sie naeher als REGION_REACH
  // liegt - sonst "other" (Wangen, Kiefer, Stirn). Die Reichweite ist in
  // Modelleinheiten (Gesichtsbreite ~14) und so gewaehlt, dass die Mengen in
  // der Groessenordnung der drei Regionen des Papers liegen.
  const REGION_REACH = 1.0;
  const contours = {
    eyes: [...EYES, ...BROWS],
    nose: NOSE,
    mouth: LIPS,
  };
  const nearest = (i, indices) => {
    const v = vertices[i];
    let best = Infinity;
    for (const j of indices) {
      const c = vertices[j];
      best = Math.min(best, Math.hypot(c.x - v.x, c.y - v.y, c.z - v.z));
    }
    return best;
  };
  const regionOf = (i) => {
    let region = "other";
    let dist = REGION_REACH;
    for (const [name, indices] of Object.entries(contours)) {
      const d = nearest(i, indices);
      if (d < dist) { dist = d; region = name; }
    }
    return region;
  };
  const regions = pairs.map(([l]) => regionOf(l));
  const allPairs = [...pairs, ...IRIS_PAIRS];
  const allRegions = [...regions, ...IRIS_PAIRS.map(() => "eyes")];
  const counts = {};
  for (const r of allRegions) counts[r] = (counts[r] ?? 0) + 1;

  const midlineFit = midline.filter((i) => !LIP_MIDLINE.includes(i));
  const rows = (arr, per) => {
    const out = [];
    for (let i = 0; i < arr.length; i += per) out.push("  " + arr.slice(i, i + per).join(", ") + ",");
    return out.join("\n");
  };

  const ts = `/**
 * GENERIERT von scripts/build-mesh-pairs.mjs - nicht von Hand aendern.
 *
 * Links-rechts-Paare des MediaPipe-Gesichtsnetzes (478 Landmarks), abgeleitet
 * aus dem spiegelsymmetrischen kanonischen Modell (canonical_face_model.obj,
 * SHA-256 ${hash}...). "links"/"rechts" meinen die Seite der Person, wie
 * MediaPipes FACE_LANDMARKS_LEFT_* / _RIGHT_*.
 *
 * 220 Netzpaare (groesster Spiegelfehler ${worst.toExponential(2)}) plus fuenf
 * Irispaare = 225 Paare, wie bei Heinrich et al., Bioengineering 2026, 13:426.
 * Regionen sind eine eigene Naeherung: naechstgelegene MediaPipe-Kontur auf
 * dem Modell innerhalb einer Reichweite (Mund ${counts.mouth}, Nase ${counts.nose},
 * Augen ${counts.eyes}, uebrige ${counts.other}); die 91-Paar-Auswahl des
 * Papers ist nicht veroeffentlicht und hier nicht enthalten.
 */

export const MESH_PAIRS_VERSION = "canonical_face_model.obj@${hash}";

/** Alle 28 Punkte der Mittellinie, Stirn bis Kinn. */
export const MIDLINE_ALL: readonly number[] = [
${rows(midline, 14)}
];

/** Die 20 Mittellinienpunkte fuer die Achsenschaetzung - ohne die Lippen. */
export const MIDLINE_FIT: readonly number[] = [
${rows(midlineFit, 10)}
];

export type PairRegion = "eyes" | "nose" | "mouth" | "other";

/** [person-links, person-rechts] je Paar. */
export const MESH_PAIRS: readonly (readonly [number, number])[] = [
${rows(allPairs.map(([l, r]) => `[${l}, ${r}]`), 6)}
];

/** Region je Paar, gleiche Reihenfolge wie MESH_PAIRS. */
export const PAIR_REGIONS: readonly PairRegion[] = [
${rows(allRegions.map((r) => `"${r}"`), 8)}
];
`;

  const out = join(root, "src", "vision", "meshPairs.ts");
  await writeFile(out, ts);
  console.log(`${allPairs.length} Paare -> src/vision/meshPairs.ts (Regionen: ${JSON.stringify(counts)}, Modell ${hash})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
