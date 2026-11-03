import type { FileReport, ScanReport } from "./scan.ts";
import { BLIND_SPOT_SCORE } from "./scan.ts";
import type { Finding, Severity } from "./types.ts";
import { SEVERITY_ORDER } from "./types.ts";
import { printableDecoded } from "./text.ts";

export interface Style {
  red(s: string): string;
  yellow(s: string): string;
  cyan(s: string): string;
  dim(s: string): string;
  bold(s: string): string;
  magenta(s: string): string;
  green(s: string): string;
}

const wrap = (open: number, close: number) => (s: string) => `\x1b[${open}m${s}\x1b[${close}m`;
export const COLOR: Style = {
  red: wrap(31, 39),
  yellow: wrap(33, 39),
  cyan: wrap(36, 39),
  dim: wrap(2, 22),
  bold: wrap(1, 22),
  magenta: wrap(35, 39),
  green: wrap(32, 39),
};
const id = (s: string) => s;
export const PLAIN: Style = { red: id, yellow: id, cyan: id, dim: id, bold: id, magenta: id, green: id };

function sevLabel(s: Severity, st: Style): string {
  const label = s.toUpperCase().padEnd(6);
  if (s === "high") return st.bold(st.red(label));
  if (s === "medium") return st.yellow(label);
  if (s === "low") return st.cyan(label);
  return st.dim(label);
}

function bar(score: number, st: Style): string {
  const n = Math.round(score / 10);
  const b = "█".repeat(n) + "░".repeat(10 - n);
  return score >= BLIND_SPOT_SCORE ? st.red(b) : st.yellow(b);
}

export function formatTerminal(report: ScanReport, min: Severity, st: Style): string {
  const out: string[] = [];
  const shown = report.files
    .map((f) => ({ ...f, findings: f.findings.filter((x) => SEVERITY_ORDER[x.severity] >= SEVERITY_ORDER[min]) }))
    .filter((f) => f.findings.length > 0);
  const { scanned, skippedBinary, skippedLarge } = report.stats;
  const skipped = skippedBinary + skippedLarge;
  out.push(
    `${st.bold("refusalbait")} scanned ${scanned} file${scanned === 1 ? "" : "s"} in ${report.root}` +
      st.dim(` (${report.elapsedMs} ms${skipped ? `, ${skipped} binary/large skipped` : ""})`),
  );
  out.push("");
  const blind = report.files.filter((f) => f.score >= BLIND_SPOT_SCORE);
  if (blind.length > 0) {
    out.push(
      st.bold(st.red(`✖ ${blind.length} file${blind.length === 1 ? "" : "s"} your AI reviewer will likely refuse, skip, or be steered by`)),
    );
  } else if (shown.length > 0) {
    out.push(st.yellow(`! no likely blind spots, ${shown.length} file${shown.length === 1 ? "" : "s"} worth a look`));
  } else {
    out.push(st.green("✔ nothing found that would make an AI reviewer refuse or skip these files"));
  }
  for (const f of shown) out.push("", ...formatFile(f, st));
  out.push("");
  const c = report.counts;
  out.push(
    st.dim("summary: ") +
      [`${c.high} high`, `${c.medium} medium`, `${c.low} low`, `${c.info} info`].join(st.dim(" · ")) +
      (min !== "info" && c.info > 0 ? st.dim(" (info hidden, use --min-severity info)") : ""),
  );
  return out.join("\n") + "\n";
}

function formatFile(f: FileReport, st: Style): string[] {
  const lines: string[] = [];
  lines.push(`${st.bold(f.path)}  ${bar(f.score, st)} ${st.bold(String(f.score))}${f.minified ? st.dim("  minified") : ""}`);
  for (const x of f.findings) lines.push(...formatFinding(x, st));
  if (f.truncated > 0) lines.push(st.dim(`  … ${f.truncated} more findings of the same kinds`));
  return lines;
}

function formatFinding(x: Finding, st: Style): string[] {
  const loc = st.dim(`${x.line}:${x.column}`.padEnd(9));
  const lines = [`  ${sevLabel(x.severity, st)} ${loc} ${x.message} ${st.dim(`${x.detector}/${x.rule}`)}`];
  if (x.decoded !== undefined) lines.push(`         ${st.magenta("decoded ▶")} ${st.bold(st.magenta(printableDecoded(x.decoded)))}`);
  else if (x.excerpt) lines.push(`         ${st.dim("│")} ${x.excerpt}`);
  return lines;
}

export function formatJson(reports: ScanReport | ScanReport[]): string {
  return JSON.stringify(reports, null, 2) + "\n";
}

const SARIF_LEVEL: Record<Severity, string> = { high: "error", medium: "warning", low: "note", info: "note" };

export function formatSarif(report: ScanReport, version: string): string {
  const rules = new Map<string, { id: string; name: string; shortDescription: { text: string } }>();
  const results = [];
  for (const f of report.files) {
    for (const x of f.findings) {
      const ruleId = `${x.detector}/${x.rule}`;
      if (!rules.has(ruleId)) rules.set(ruleId, { id: ruleId, name: x.rule, shortDescription: { text: `${x.detector}: ${x.rule}` } });
      results.push({
        ruleId,
        level: SARIF_LEVEL[x.severity],
        message: { text: x.message + (x.decoded !== undefined ? ` Decoded: ${printableDecoded(x.decoded)}` : "") },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: f.path },
              region: { startLine: x.line, startColumn: x.column },
            },
          },
        ],
        properties: { severity: x.severity, fileScore: f.score },
      });
    }
  }
  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "refusalbait",
            version,
            informationUri: "https://github.com/jatingargiitk/refusalbait",
            rules: [...rules.values()],
          },
        },
        results,
      },
    ],
  };
  return JSON.stringify(sarif, null, 2) + "\n";
}
