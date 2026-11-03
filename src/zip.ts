import { inflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  /** Uncompressed size from the central directory. */
  size: number;
  /** Lazily inflates the entry; throws if it is larger than `maxBytes`. */
  read(maxBytes: number): Buffer;
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

/**
 * Minimal reader for .zip/.vsix archives: stored and deflated entries,
 * no encryption, no zip64. Enough for VS Code extensions, which are plain zips.
 */
export function readZip(buf: Buffer): ZipEntry[] {
  // The end-of-central-directory record sits in the last 22 + 65535 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip archive (no end-of-central-directory record)");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || off === 0xffffffff) throw new Error("zip64 archives are not supported");

  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== CEN_SIG) throw new Error("corrupt zip central directory");
    const flags = buf.readUInt16LE(off + 8);
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const size = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.toString(flags & 0x800 ? "utf8" : "latin1", off + 46, off + 46 + nameLen);
    off += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;

    entries.push({
      name,
      size,
      read(maxBytes: number): Buffer {
        if (flags & 1) throw new Error(`${name}: encrypted entries are not supported`);
        if (size > maxBytes) throw new Error(`${name}: larger than ${maxBytes} bytes`);
        if (buf.readUInt32LE(local) !== LOC_SIG) throw new Error(`${name}: corrupt local header`);
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const raw = buf.subarray(start, start + compSize);
        if (method === 0) return raw;
        if (method === 8) return inflateRawSync(raw, { maxOutputLength: Math.max(1, maxBytes) });
        throw new Error(`${name}: unsupported compression method ${method}`);
      },
    });
  }
  return entries;
}
