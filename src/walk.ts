import { lstat, open, readdir } from "node:fs/promises";
import path from "node:path";

export interface WalkOptions {
  /** Skip files larger than this many bytes. */
  maxBytes: number;
  /** Descend into node_modules (always true when the target itself is inside one). */
  nodeModules: boolean;
  /** Extra directory or file names to skip. */
  ignore: string[];
}

export interface WalkedFile {
  abs: string;
  /** Relative to the scan root, forward slashes. */
  rel: string;
  text: string;
}

export interface WalkStats {
  scanned: number;
  skippedBinary: number;
  skippedLarge: number;
}

const ALWAYS_SKIP = new Set([".git", ".hg", ".svn", ".DS_Store"]);

const BINARY_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tiff", "psd", "pdf", "zip", "gz", "tgz", "bz2", "xz", "7z",
  "rar", "jar", "war", "class", "so", "dylib", "dll", "exe", "bin", "o", "a", "node", "wasm", "woff", "woff2",
  "ttf", "otf", "eot", "mp3", "mp4", "mov", "avi", "webm", "ogg", "wav", "flac", "sqlite", "db", "pyc", "vsix",
]);

/** A NUL byte in the first 8 KB means binary, the same heuristic git uses. */
function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

export async function* walk(root: string, opts: WalkOptions, stats: WalkStats): AsyncGenerator<WalkedFile> {
  const absRoot = path.resolve(root);
  const rootStat = await lstat(absRoot);
  const insideNodeModules = absRoot.split(path.sep).includes("node_modules");
  const allowNodeModules = opts.nodeModules || insideNodeModules;
  const skip = new Set([...ALWAYS_SKIP, ...opts.ignore]);

  async function* visit(abs: string, rel: string): AsyncGenerator<WalkedFile> {
    const st = await lstat(abs);
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) {
      const entries = await readdir(abs);
      entries.sort();
      for (const name of entries) {
        if (skip.has(name)) continue;
        if (name === "node_modules" && !allowNodeModules) continue;
        yield* visit(path.join(abs, name), rel ? `${rel}/${name}` : name);
      }
      return;
    }
    if (!st.isFile()) return;
    const ext = path.extname(abs).slice(1).toLowerCase();
    if (BINARY_EXT.has(ext)) {
      stats.skippedBinary++;
      return;
    }
    if (st.size > opts.maxBytes) {
      stats.skippedLarge++;
      return;
    }
    const fh = await open(abs, "r");
    let buf: Buffer;
    try {
      buf = await fh.readFile();
    } finally {
      await fh.close();
    }
    if (looksBinary(buf)) {
      stats.skippedBinary++;
      return;
    }
    stats.scanned++;
    yield { abs, rel: rel || path.basename(abs), text: buf.toString("utf8") };
  }

  if (rootStat.isFile()) yield* visit(absRoot, path.basename(absRoot));
  else yield* visit(absRoot, "");
}
