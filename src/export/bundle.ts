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

/**
 * Packs a set of files into a ZIP. Text is encoded as UTF-8.
 *
 * Stored, not deflated (see the header): the caller decides what goes in, so
 * both pages share one packer instead of two.
 */
export async function packZip(files: Record<string, Uint8Array | string>): Promise<Blob> {
  const store = { level: 0 } as const;
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const [name, data] of Object.entries(files)) {
    entries[name] = [typeof data === "string" ? strToU8(data) : data, store];
  }

  const packed = await new Promise<Uint8Array>((resolve, reject) => {
    zip(entries, { level: 0 }, (err, data) => (err ? reject(err) : resolve(data)));
  });

  return new Blob([packed as BlobPart], { type: "application/zip" });
}

export async function buildBundle({ session, manifest }: BundleInput): Promise<Blob> {
  const files: Record<string, Uint8Array | string> = {};

  files[`video.${fileExtensionFor(session.recording.mimeType)}`] = new Uint8Array(
    await session.recording.blob.arrayBuffer(),
  );

  for (const result of session.results) {
    if (!result.still) continue;
    files[`${positionSlug(result.spec)}.jpg`] = new Uint8Array(await result.still.blob.arrayBuffer());
  }

  files["manifest.json"] = JSON.stringify(manifest, null, 2);
  files["README.txt"] = readme(session);

  return packZip(files);
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
