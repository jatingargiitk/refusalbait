import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { exitCode, main, parseArgs } from "../src/cli.ts";

const FIXTURES = path.join(import.meta.dirname, "fixtures");

async function run(...argv: string[]) {
  let out = "";
  let err = "";
  const code = await main(argv, (s) => (out += s), (s) => (err += s), {}, false);
  return { code, out, err };
}

describe("parseArgs", () => {
  it("has sensible defaults", () => {
    expect(parseArgs([])).toMatchObject({ paths: ["."], format: "terminal", failOn: "high", minSeverity: "low", color: false });
  });
  it("enables color on a TTY unless NO_COLOR, and with FORCE_COLOR", () => {
    expect(parseArgs([], {}, true)).toMatchObject({ color: true });
    expect(parseArgs([], { NO_COLOR: "1" }, true)).toMatchObject({ color: false });
    expect(parseArgs([], { FORCE_COLOR: "1" }, false)).toMatchObject({ color: true });
  });
  it("parses every option", () => {
    expect(
      parseArgs(["a", "b", "--sarif", "--fail-on", "none", "--min-severity", "info", "--node-modules", "--ignore", "dist", "--max-size", "10"]),
    ).toMatchObject({ paths: ["a", "b"], format: "sarif", failOn: "none", minSeverity: "info", nodeModules: true, ignore: ["dist"], maxBytes: 10 });
  });
  it("rejects bad values", () => {
    expect(() => parseArgs(["--fail-on", "critical"])).toThrow(/--fail-on/);
    expect(() => parseArgs(["--max-size", "-1"])).toThrow(/--max-size/);
    expect(() => parseArgs(["--wat"])).toThrow(/unknown option/);
  });
});

describe("main", () => {
  it("prints a terminal report and exits 1 on high findings", async () => {
    const { code, out } = await run(FIXTURES);
    expect(code).toBe(1);
    expect(out).toContain("your AI reviewer will likely refuse");
    expect(out).toContain("decoded ▶ SYSTEM OVERRIDE");
    expect(out).not.toContain("\x1b[");
    expect(out).not.toMatch(/[\u{E0000}-\u{E007F}\u202A-\u202E\u2066-\u2069]/u);
  });

  it("respects --fail-on", async () => {
    expect((await run(FIXTURES, "--fail-on", "none")).code).toBe(0);
    expect((await run(path.join(FIXTURES, "clean"), "--fail-on", "low")).code).toBe(0);
    expect((await run(path.join(FIXTURES, "clean"), "--fail-on", "info")).code).toBe(1);
  });

  it("says so when nothing is found", async () => {
    const { code, out } = await run(path.join(FIXTURES, "clean", "i18n.js"));
    expect(code).toBe(0);
    expect(out).toContain("✔ nothing found");
  });

  it("emits JSON and valid-looking SARIF", async () => {
    const json = JSON.parse((await run(FIXTURES, "--json")).out);
    expect(json.files[0].score).toBe(100);
    const sarif = JSON.parse((await run(FIXTURES, "--sarif")).out);
    expect(sarif.version).toBe("2.1.0");
    const result = sarif.runs[0].results.find((r: { ruleId: string }) => r.ruleId === "hidden-unicode/unicode-tags");
    expect(result.level).toBe("error");
    expect(result.message.text).toContain("Decoded: SYSTEM OVERRIDE");
    expect(result.locations[0].physicalLocation.region).toEqual({ startLine: 4, startColumn: 27 });
    expect(sarif.runs[0].tool.driver.rules.length).toBeGreaterThan(3);
  });

  it("returns 2 on usage errors and missing paths", async () => {
    expect((await run("--fail-on")).code).toBe(2);
    const missing = await run(path.join(FIXTURES, "nope"));
    expect(missing.code).toBe(2);
    expect(missing.err).toContain("cannot scan");
  });

  it("prints help and version", async () => {
    expect((await run("--help")).out).toContain("Usage: refusalbait");
    expect((await run("-v")).out).toMatch(/^\d+\.\d+\.\d+\n$/);
  });
});

describe("exitCode", () => {
  it("compares the worst severity across reports to --fail-on", () => {
    const r = (high: number, low: number) => ({ root: "", files: [], stats: { scanned: 0, skippedBinary: 0, skippedLarge: 0 }, elapsedMs: 0, counts: { high, medium: 0, low, info: 0 } });
    expect(exitCode([r(0, 1)], "high")).toBe(0);
    expect(exitCode([r(0, 1), r(1, 0)], "high")).toBe(1);
    expect(exitCode([r(0, 1)], "low")).toBe(1);
  });
});

describe("as a process", () => {
  const [maj, min] = process.versions.node.split(".").map(Number) as [number, number];
  const canStrip = maj > 22 || (maj === 22 && min >= 6);
  it.skipIf(!canStrip)("runs from source with node's type stripping", () => {
    const res = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/cli.ts", "--version"], {
      cwd: path.join(import.meta.dirname, ".."),
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
