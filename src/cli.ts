#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { COLOR, PLAIN, formatJson, formatSarif, formatTerminal } from "./format.ts";
import { scan, worstSeverity, type ScanReport } from "./scan.ts";
import { SEVERITY_ORDER, type Severity } from "./types.ts";

const VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const HELP = `refusalbait ${VERSION}
Find code built to make AI reviewers refuse, skip, or get steered.

Usage: refusalbait [path ...] [options]

  path                   folder or file to scan (default: .)

Options:
  --json                 print the full report as JSON
  --sarif                print SARIF 2.1.0 (for GitHub code scanning)
  --fail-on <severity>   exit 1 if any finding is at or above this level:
                         high (default), medium, low, info, or none
  --min-severity <sev>   hide findings below this level in the terminal (default: low)
  --node-modules         also scan node_modules folders (automatic when the target is inside one)
  --ignore <name>        skip files or folders with this name (repeatable)
  --max-size <bytes>     skip files larger than this (default: 2000000)
  --no-color             plain output (also honours NO_COLOR)
  -h, --help             show this help
  -v, --version          show the version

Exit codes: 0 clean, 1 findings at or above --fail-on, 2 usage or I/O error.
`;

export interface CliOptions {
  paths: string[];
  format: "terminal" | "json" | "sarif";
  failOn: Severity | "none";
  minSeverity: Severity;
  nodeModules: boolean;
  ignore: string[];
  maxBytes: number;
  color: boolean;
}

class UsageError extends Error {}

const SEVERITIES = ["high", "medium", "low", "info"];

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = {}, isTTY = false): CliOptions | "help" | "version" {
  const o: CliOptions = {
    paths: [],
    format: "terminal",
    failOn: "high",
    minSeverity: "low",
    nodeModules: false,
    ignore: [],
    maxBytes: 2_000_000,
    color: isTTY && !env.NO_COLOR,
  };
  if (env.FORCE_COLOR && env.FORCE_COLOR !== "0") o.color = true;
  const value = (i: number, flag: string) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new UsageError(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case "-h":
      case "--help":
        return "help";
      case "-v":
      case "--version":
        return "version";
      case "--json":
        o.format = "json";
        break;
      case "--sarif":
        o.format = "sarif";
        break;
      case "--fail-on": {
        const v = value(i++, a);
        if (v !== "none" && !SEVERITIES.includes(v)) throw new UsageError(`--fail-on must be one of ${SEVERITIES.join(", ")}, none`);
        o.failOn = v as Severity | "none";
        break;
      }
      case "--min-severity": {
        const v = value(i++, a);
        if (!SEVERITIES.includes(v)) throw new UsageError(`--min-severity must be one of ${SEVERITIES.join(", ")}`);
        o.minSeverity = v as Severity;
        break;
      }
      case "--node-modules":
        o.nodeModules = true;
        break;
      case "--ignore":
        o.ignore.push(value(i++, a));
        break;
      case "--max-size": {
        const n = Number(value(i++, a));
        if (!Number.isFinite(n) || n <= 0) throw new UsageError("--max-size must be a positive number of bytes");
        o.maxBytes = n;
        break;
      }
      case "--no-color":
        o.color = false;
        break;
      default:
        if (a.startsWith("-")) throw new UsageError(`unknown option ${a}`);
        o.paths.push(a);
    }
  }
  if (o.paths.length === 0) o.paths.push(".");
  return o;
}

export function exitCode(reports: ScanReport[], failOn: Severity | "none"): number {
  if (failOn === "none") return 0;
  for (const r of reports) {
    const worst = worstSeverity(r);
    if (worst && SEVERITY_ORDER[worst] >= SEVERITY_ORDER[failOn]) return 1;
  }
  return 0;
}

export async function main(argv: string[], out: (s: string) => void, err: (s: string) => void, env: NodeJS.ProcessEnv, isTTY: boolean): Promise<number> {
  let opts: ReturnType<typeof parseArgs>;
  try {
    opts = parseArgs(argv, env, isTTY);
  } catch (e) {
    if (e instanceof UsageError) {
      err(`refusalbait: ${e.message}\nRun refusalbait --help for usage.\n`);
      return 2;
    }
    throw e;
  }
  if (opts === "help") {
    out(HELP);
    return 0;
  }
  if (opts === "version") {
    out(VERSION + "\n");
    return 0;
  }
  const reports: ScanReport[] = [];
  for (const p of opts.paths) {
    try {
      reports.push(await scan(p, { maxBytes: opts.maxBytes, nodeModules: opts.nodeModules, ignore: opts.ignore }));
    } catch (e) {
      err(`refusalbait: cannot scan ${p}: ${(e as Error).message}\n`);
      return 2;
    }
  }
  if (opts.format === "json") out(formatJson(reports.length === 1 ? reports[0]! : reports));
  else if (opts.format === "sarif") {
    const merged: ScanReport = {
      ...reports[0]!,
      files: reports.flatMap((r) => r.files),
    };
    out(formatSarif(merged, VERSION));
  } else for (const r of reports) out(formatTerminal(r, opts.minSeverity, opts.color ? COLOR : PLAIN));
  return exitCode(reports, opts.failOn);
}

function isEntry(): boolean {
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(arg)).href;
  } catch {
    return false;
  }
}

if (isEntry()) {
  main(process.argv.slice(2), (s) => process.stdout.write(s), (s) => process.stderr.write(s), process.env, Boolean(process.stdout.isTTY)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      process.stderr.write(`refusalbait: ${(e as Error).stack ?? e}\n`);
      process.exitCode = 2;
    },
  );
}
