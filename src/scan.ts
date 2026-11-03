import { detectBait } from "./detectors/bait.ts";
import { detectChatTokens } from "./detectors/chat-tokens.ts";
import { detectHidden } from "./detectors/hidden.ts";
import { detectReviewerInstructions } from "./detectors/reviewer.ts";
import type { Detector, FileContext, Finding, Severity } from "./types.ts";
import { SEVERITY_ORDER } from "./types.ts";
import { walk, type WalkOptions, type WalkStats } from "./walk.ts";

export const DETECTORS: Detector[] = [detectHidden, detectBait, detectChatTokens, detectReviewerInstructions];

/** Points per finding. A file at 25+ has at least one high finding's worth of evidence. */
export const WEIGHTS: Record<Severity, number> = { high: 25, medium: 8, low: 2, info: 0 };
export const BLIND_SPOT_SCORE = 25;
const MAX_PER_RULE = 20;

export interface FileReport {
  path: string;
  score: number;
  minified: boolean;
  findings: Finding[];
  /** Findings dropped because one rule fired more than MAX_PER_RULE times. */
  truncated: number;
}

export interface ScanReport {
  root: string;
  files: FileReport[];
  stats: WalkStats;
  counts: Record<Severity, number>;
  elapsedMs: number;
}

// Docs and data files (JSON dumps, CSV) are mostly human text: words like "suicide" or
// "cocaine" there are content, not identifiers, so they are treated as prose.
const PROSE_EXT = /\.(?:md|markdown|mdx|txt|rst|adoc|asciidoc|org|json|jsonl|ndjson|csv|tsv)$/i;

export function isMinified(path: string, text: string): boolean {
  if (/\.min\.(?:js|mjs|cjs|css)$/i.test(path)) return true;
  if (text.length < 2000) return false;
  let longest = 0;
  let lines = 1;
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text.charCodeAt(i) === 10) {
      longest = Math.max(longest, i - start);
      start = i + 1;
      if (i < text.length) lines++;
    }
  }
  return longest > 1000 || text.length / lines > 300;
}

export function fileContext(path: string, text: string): FileContext {
  return { path, minified: isMinified(path, text), prose: PROSE_EXT.test(path) };
}

export function scoreFindings(findings: Finding[]): number {
  return Math.min(100, findings.reduce((s, f) => s + WEIGHTS[f.severity], 0));
}

export function scanText(path: string, text: string): FileReport {
  const ctx = fileContext(path, text);
  const all = DETECTORS.flatMap((d) => d(text, ctx));
  all.sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] || a.line - b.line || a.column - b.column);
  const perRule = new Map<string, number>();
  const findings: Finding[] = [];
  let truncated = 0;
  for (const f of all) {
    const n = (perRule.get(f.rule) ?? 0) + 1;
    perRule.set(f.rule, n);
    if (n > MAX_PER_RULE) truncated++;
    else findings.push(f);
  }
  return { path, score: scoreFindings(all), minified: ctx.minified, findings, truncated };
}

export async function scan(root: string, opts: WalkOptions): Promise<ScanReport> {
  const t0 = performance.now();
  const stats: WalkStats = { scanned: 0, skippedBinary: 0, skippedLarge: 0 };
  const files: FileReport[] = [];
  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0, info: 0 };
  for await (const f of walk(root, opts, stats)) {
    const r = scanText(f.rel, f.text);
    if (r.findings.length === 0) continue;
    for (const x of r.findings) counts[x.severity]++;
    files.push(r);
  }
  files.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return { root, files, stats, counts, elapsedMs: Math.round(performance.now() - t0) };
}

/** Highest severity present in the report, or undefined when clean. */
export function worstSeverity(report: ScanReport): Severity | undefined {
  for (const s of ["high", "medium", "low", "info"] as Severity[]) if (report.counts[s] > 0) return s;
  return undefined;
}
