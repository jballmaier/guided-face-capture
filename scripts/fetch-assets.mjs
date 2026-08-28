/**
 * Holt die MediaPipe-Assets nach public/mediapipe/, damit die Seite zur
 * Laufzeit keinen einzigen Netzwerkaufruf mehr macht.
 *
 * Das ist keine Bequemlichkeit, sondern die Voraussetzung dafuer, den
 * Prototyp spaeter ueberhaupt mit Patientenbezug zeigen zu koennen: Wer das
 * Modell vom Google-CDN nachlaedt, meldet jedem Seitenaufruf an einen Dritten.
 *
 *   node scripts/fetch-assets.mjs
 */
import { cp, mkdir, writeFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "public", "mediapipe");

// Bewusst auf Version 1 gepinnt statt "latest": Die Landmark-Werte muessen
// zwischen zwei Aufnahmen desselben Patienten vergleichbar bleiben, und die
// Modellversion wandert ins Manifest.
const MODEL_VERSION = "1";
const MODEL_URL =
  `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/${MODEL_VERSION}/face_landmarker.task`;

async function main() {
  await mkdir(join(target, "wasm"), { recursive: true });
  await mkdir(join(target, "models"), { recursive: true });

  // 1. WASM-Laufzeit aus node_modules kopieren (kein Download noetig).
  // Direkter Pfad statt require.resolve: tasks-vision exportiert seine
  // package.json nicht, damit scheitert jede Aufloesung ueber "exports".
  const wasmSrc = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
  await cp(wasmSrc, join(target, "wasm"), { recursive: true });
  console.log(`WASM  -> public/mediapipe/wasm  (aus ${wasmSrc})`);

  // 2. Modell laden.
  const modelPath = join(target, "models", "face_landmarker.task");
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`Modell-Download fehlgeschlagen: HTTP ${res.status} ${MODEL_URL}`);
  await writeFile(modelPath, Buffer.from(await res.arrayBuffer()));
  const { size } = await stat(modelPath);
  console.log(`Modell -> public/mediapipe/models/face_landmarker.task (${(size / 1024 / 1024).toFixed(1)} MB, v${MODEL_VERSION})`);

  // 3. Version festhalten, damit sie ins Manifest wandern kann.
  await writeFile(
    join(target, "models", "version.json"),
    JSON.stringify({ model: "face_landmarker", variant: "float16", version: MODEL_VERSION, source: MODEL_URL, fetched: new Date().toISOString() }, null, 2),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
