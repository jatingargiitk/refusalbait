import { describe, expect, it } from "vitest";
import { detectBait, splitIdentifier } from "../src/detectors/bait.ts";
import type { FileContext } from "../src/types.ts";

const code: FileContext = { path: "a.js", minified: false, prose: false };

describe("splitIdentifier", () => {
  it("splits camelCase, PascalCase, snake_case and acronyms", () => {
    expect(splitIdentifier("computeRicinLethalDosageForWaterSupply")).toEqual([
      "compute", "ricin", "lethal", "dosage", "for", "water", "supply",
    ]);
    expect(splitIdentifier("SARIN_yield_v2")).toEqual(["sarin", "yield", "v"]);
    expect(splitIdentifier("parseHTMLNerveAgent")).toEqual(["parse", "html", "nerve", "agent"]);
  });
});

describe("detectBait", () => {
  it("rates a bait term fused with an amplifier in one identifier as high", () => {
    const [f, ...rest] = detectBait("function computeRicinLethalDosageForWaterSupply(a){return a*2}", code);
    expect(rest).toHaveLength(0);
    expect(f).toMatchObject({
      rule: "bait-cbrn",
      severity: "high",
      line: 1,
      column: 10,
      excerpt: "computeRicinLethalDosageForWaterSupply",
    });
  });

  it("rates a lone strong term as medium and counts repeats once", () => {
    const f = detectBait("const anthrax = 1;\nlog(anthrax);\nlog(anthrax);", code);
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("medium");
    expect(f[0]!.message).toContain("3 times");
  });

  it("matches two-word phrases across separators", () => {
    const [f] = detectBait("const nerve_agent_table = {};", code);
    expect(f).toMatchObject({ rule: "bait-cbrn", message: expect.stringContaining('"nerve agent"') });
  });

  it("ignores weak terms unless an amplifier is close", () => {
    expect(detectBait("const uraniumMass = 238;", code)).toEqual([]);
    expect(detectBait("const uraniumEnrichmentLevel = 0.9;", code)[0]!.severity).toBe("high");
  });

  it("does not match substrings inside ordinary words", () => {
    expect(detectBait("const pricing = getPricingTable(); const methodName = 'sharing';", code)).toEqual([]);
  });

  it("bumps severity in minified files and near eval", () => {
    expect(detectBait("var x=1;var sarinTable=2;", { ...code, minified: true })[0]!.severity).toBe("high");
    expect(detectBait("const fentanyl = 'x';\neval(code);", code)[0]).toMatchObject({
      severity: "high",
      message: expect.stringContaining("eval"),
    });
  });

  it("skips prose files entirely", () => {
    expect(detectBait("Ricin is a lethal toxin.", { ...code, prose: true })).toEqual([]);
  });

  it("reports censorship tripwires as info", () => {
    const [f] = detectBait('const s = "天安门";', code);
    expect(f).toMatchObject({ rule: "censorship-tripwire", severity: "info" });
  });

  it("finds nothing in ordinary code", () => {
    const src = "export function computeDosageForPatient(weightKg) { return weightKg * 0.1; }\nconst explosiveGrowth = true;";
    expect(detectBait(src, code)).toEqual([]);
  });
});
