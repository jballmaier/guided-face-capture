/**
 * ZIP-Schreiber fuer unkomprimierte Eintraege.
 *
 * Die Buendel bestehen aus Video und JPEG - beides schon komprimiert, deshalb
 * wird gespeichert, nicht deflatiert. Das erlaubt einen entscheidenden Trick:
 * Blobs wandern als Blob-Teile direkt in das Ergebnis, ohne je als Bytes im
 * JS-Heap zu liegen. Nur die CRC32-Pruefsumme muss die Daten einmal lesen,
 * und das geschieht stueckweise ueber den Stream. Vorher lagen beim Packen
 * Rohdaten, Archiv und Blob-Kopie gleichzeitig im Speicher - beim
 * ungeschnittenen Vollbild in Maximalgroesse mehrere hundert Megabyte, ein
 * Tab-Tod auf genau den Geraeten, fuer die die Seite gebaut ist.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crcUpdate(crc: number, chunk: Uint8Array): number {
  let c = crc;
  for (let i = 0; i < chunk.length; i++) c = CRC_TABLE[(c ^ chunk[i]!) & 0xff]! ^ (c >>> 8);
  return c >>> 0;
}

/** CRC32 eines Blobs, stueckweise gelesen - haelt nie mehr als einen Chunk. */
async function crcOfBlob(blob: Blob): Promise<number> {
  let crc = 0xffffffff;
  const reader = blob.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    crc = crcUpdate(crc, value);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function crcOfBytes(bytes: Uint8Array): number {
  return (crcUpdate(0xffffffff, bytes) ^ 0xffffffff) >>> 0;
}

/** MS-DOS-Zeitstempel, wie das ZIP-Format ihn verlangt. */
function dosDateTime(date: Date): { time: number; date: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date:
      ((Math.max(1980, date.getFullYear()) - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate(),
  };
}

interface EntryMeta {
  nameBytes: Uint8Array;
  crc: number;
  size: number;
  offset: number;
  time: number;
  date: number;
}

function writeU16(view: DataView, at: number, value: number): void {
  view.setUint16(at, value, true);
}
function writeU32(view: DataView, at: number, value: number): void {
  view.setUint32(at, value >>> 0, true);
}

function localHeader(meta: EntryMeta): Uint8Array {
  const header = new Uint8Array(30 + meta.nameBytes.length);
  const view = new DataView(header.buffer);
  writeU32(view, 0, 0x04034b50);
  writeU16(view, 4, 20); // Version 2.0 - gespeichert, kein ZIP64
  writeU16(view, 6, 0x0800); // Dateinamen sind UTF-8
  writeU16(view, 8, 0); // Methode: gespeichert
  writeU16(view, 10, meta.time);
  writeU16(view, 12, meta.date);
  writeU32(view, 14, meta.crc);
  writeU32(view, 18, meta.size);
  writeU32(view, 22, meta.size);
  writeU16(view, 26, meta.nameBytes.length);
  writeU16(view, 28, 0);
  header.set(meta.nameBytes, 30);
  return header;
}

function centralDirectory(entries: readonly EntryMeta[], cdOffset: number): Uint8Array {
  const size = entries.reduce((sum, e) => sum + 46 + e.nameBytes.length, 0);
  const out = new Uint8Array(size + 22);
  const view = new DataView(out.buffer);
  let at = 0;
  for (const e of entries) {
    writeU32(view, at, 0x02014b50);
    writeU16(view, at + 4, 20);
    writeU16(view, at + 6, 20);
    writeU16(view, at + 8, 0x0800);
    writeU16(view, at + 10, 0);
    writeU16(view, at + 12, e.time);
    writeU16(view, at + 14, e.date);
    writeU32(view, at + 16, e.crc);
    writeU32(view, at + 20, e.size);
    writeU32(view, at + 24, e.size);
    writeU16(view, at + 28, e.nameBytes.length);
    // Extra, Kommentar, Disk, interne/externe Attribute: alles null.
    writeU32(view, at + 42, e.offset);
    out.set(e.nameBytes, at + 46);
    at += 46 + e.nameBytes.length;
  }
  writeU32(view, at, 0x06054b50);
  writeU16(view, at + 8, entries.length);
  writeU16(view, at + 10, entries.length);
  writeU32(view, at + 12, size);
  writeU32(view, at + 16, cdOffset);
  return out;
}

/**
 * Packt die Dateien in ein gespeichertes ZIP.
 *
 * Blob-Eintraege bleiben Blobs: sie werden fuer die Pruefsumme einmal
 * durchgelesen und dann per Referenz eingehaengt. Text wird als UTF-8
 * kodiert.
 */
export async function packStoredZip(
  files: Record<string, Uint8Array | string | Blob>,
): Promise<Blob> {
  const encoder = new TextEncoder();
  const stamp = dosDateTime(new Date());
  const parts: BlobPart[] = [];
  const metas: EntryMeta[] = [];
  let offset = 0;

  for (const [name, data] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    const meta: EntryMeta =
      bytes instanceof Blob
        ? { nameBytes, crc: await crcOfBlob(bytes), size: bytes.size, offset, ...stamp }
        : { nameBytes, crc: crcOfBytes(bytes), size: bytes.length, offset, ...stamp };

    const header = localHeader(meta);
    // Casts, weil TypeScript Uint8Array seit den 2024er-Libs nicht mehr als
    // BlobPart durchwinkt - zur Laufzeit ist es einer.
    parts.push(header as BlobPart, bytes instanceof Blob ? bytes : (bytes as BlobPart));
    metas.push(meta);
    offset += header.length + meta.size;
  }

  parts.push(centralDirectory(metas, offset) as BlobPart);
  return new Blob(parts, { type: "application/zip" });
}
