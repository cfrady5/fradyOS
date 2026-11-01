import { inflateRawSync } from "node:zlib";

/**
 * Minimal ZIP reader for export archives: walks the central directory and inflates stored or
 * deflated entries. No dependency, enough for the handful of CSVs in a WHOOP or NOOP export.
 */
export interface ZipEntry {
  name: string;
  data: Buffer;
}

export function readZip(buf: Buffer, options: { maxEntries?: number; maxBytes?: number } = {}): ZipEntry[] {
  const maxEntries = options.maxEntries ?? 64;
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  // End of central directory record: signature 0x06054b50, searched backwards (comment may follow).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70_000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip archive");
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  let total = 0;
  for (let n = 0; n < Math.min(count, maxEntries); n++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) throw new Error("corrupt zip directory");
    const method = buf.readUInt16LE(offset + 10);
    const compressed = buf.readUInt32LE(offset + 20);
    const uncompressed = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString("utf8");
    offset += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    total += uncompressed;
    if (total > maxBytes) throw new Error("archive too large");
    // Local header: skip its own name and extra fields to reach the data.
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("corrupt zip entry");
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compressed);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw, { maxOutputLength: maxBytes });
    else throw new Error(`unsupported zip compression ${method}`);
    entries.push({ name, data });
  }
  return entries;
}
