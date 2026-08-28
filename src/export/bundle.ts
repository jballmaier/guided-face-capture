import { zip, strToU8 } from "fflate";
import { fileExtensionFor } from "../capture/recorder";
import { positionSlug } from "../protocol/positions";
import type { SessionResult } from "../session/session";
import { t } from "../i18n";

/**
 * Packs video, stills and manifest into a ZIP - the only way out. No upload.
 *
 * Stored, not deflated: video and JPEG are already compressed, a second pass
 * costs time and tends to grow the file.
 */

export interface BundleInput {
  session: SessionResult;
  manifest: Record<string, unknown>;
}

export async function buildBundle({ session, manifest }: BundleInput): Promise<Blob> {
  const files: Record<string, [Uint8Array, { level: 0 }]> = {};
  const store = { level: 0 } as const;

  const videoName = `video.${fileExtensionFor(session.recording.mimeType)}`;
  files[videoName] = [new Uint8Array(await session.recording.blob.arrayBuffer()), store];

  for (const result of session.results) {
    if (!result.still) continue;
    const name = `${positionSlug(result.spec)}.jpg`;
    files[name] = [new Uint8Array(await result.still.blob.arrayBuffer()), store];
  }

  files["manifest.json"] = [strToU8(JSON.stringify(manifest, null, 2)), store];
  files["README.txt"] = [strToU8(readme(session)), store];

  const packed = await new Promise<Uint8Array>((resolve, reject) => {
    zip(files, { level: 0 }, (err, data) => (err ? reject(err) : resolve(data)));
  });

  return new Blob([packed as BlobPart], { type: "application/zip" });
}

function readme(session: SessionResult): string {
  const captured = session.results.filter((r) => r.still).length;
  return [
    t("bundle.title"),
    "===========================================",
    "",
    t("bundle.recorded", { time: session.startedAt }),
    t("review.summary", { captured, total: session.results.length }),
    "",
    t("bundle.contents"),
    "------",
    `  ${t("bundle.video", { file: "video.*" })}`,
    `  ${t("bundle.stills")}`,
    `  ${t("bundle.manifest")}`,
    "",
    t("bundle.sides"),
    "---------------------------",
    t("bundle.mirrorNote"),
    t("bundle.mirrorField"),
    "",
    t("bundle.prototype"),
    "",
  ].join("\n");
}

/** Triggers the download and releases the object URL afterwards. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
