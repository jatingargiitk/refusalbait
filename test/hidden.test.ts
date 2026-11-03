import { describe, expect, it } from "vitest";
import { decodeTags, decodeVariationSelectors, decodeZeroWidthBinary, detectHidden } from "../src/detectors/hidden.ts";
import type { FileContext } from "../src/types.ts";

const code: FileContext = { path: "a.js", minified: false, prose: false };
const prose: FileContext = { path: "README.md", minified: false, prose: true };

const tagEncode = (s: string) => [...s].map((c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join("");
const vsEncode = (s: string) =>
  [...new TextEncoder().encode(s)].map((b) => String.fromCodePoint(b < 16 ? 0xfe00 + b : 0xe0100 + b - 16)).join("");
const zwEncode = (s: string) =>
  [...new TextEncoder().encode(s)]
    .map((b) => b.toString(2).padStart(8, "0").replace(/0/g, "\u200b").replace(/1/g, "\u200c"))
    .join("");

describe("decoders", () => {
  it("decodes tag characters to ASCII", () => {
    expect(decodeTags([...tagEncode("hi there")].map((c) => c.codePointAt(0)!))).toBe("hi there");
  });
  it("decodes variation-selector bytes", () => {
    expect(decodeVariationSelectors([...vsEncode("héllo")].map((c) => c.codePointAt(0)!))).toBe("héllo");
  });
  it("decodes zero-width binary in either bit order", () => {
    expect(decodeZeroWidthBinary([...zwEncode("ok go")].map((c) => c.codePointAt(0)!))).toBe("ok go");
  });
});

describe("detectHidden", () => {
  it("finds and decodes a tag-character payload with its position", () => {
    const text = `const a = 1;\nconst b = "x${tagEncode("SYSTEM OVERRIDE")}";\n`;
    const [f, ...rest] = detectHidden(text, code);
    expect(rest).toHaveLength(0);
    expect(f).toMatchObject({ rule: "unicode-tags", severity: "high", line: 2, column: 13, decoded: "SYSTEM OVERRIDE" });
  });

  it("ignores the tag sequence inside a subdivision flag emoji", () => {
    const england = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}";
    expect(detectHidden(`const flag = "${england}";`, code)).toEqual([]);
  });

  it("finds variation-selector smuggling but not a single emoji selector", () => {
    expect(detectHidden("const heart = '❤\uFE0F';", code)).toEqual([]);
    expect(detectHidden("const tools = '🛠\uFE0F\uFE0F';", code)).toEqual([]);
    const [f] = detectHidden(`const s = "a${vsEncode("run me")}";`, code);
    expect(f).toMatchObject({ rule: "variation-selector-smuggling", severity: "high", decoded: "run me" });
  });

  it("flags bidi overrides as high in code and medium in prose", () => {
    const text = 'if (role === "user\u202E \u2066// admin\u2069 \u2066") {}';
    const f = detectHidden(text, code);
    expect(f).toHaveLength(1);
    expect(f[0]!.message).toContain("U+202E, U+2066, U+2069");
    expect(f[0]!.severity).toBe("high");
    expect(detectHidden(text, prose)[0]!.severity).toBe("medium");
  });

  it("decodes zero-width binary text", () => {
    const [f] = detectHidden(`let x = 1;${zwEncode("hidden")}`, code);
    expect(f).toMatchObject({ rule: "zero-width-binary", decoded: "hidden" });
  });

  it("leaves emoji ZWJ sequences, non-Latin joiners and a leading BOM alone", () => {
    expect(detectHidden("\uFEFFconst dev = '👩\u200D💻';", code)).toEqual([]);
    expect(detectHidden("const word = 'می\u200Cخواهم';", code)).toEqual([]);
  });

  it("reports a stray zero-width space in code as low, not in prose", () => {
    expect(detectHidden("const a\u200B = 1;", code)[0]).toMatchObject({ rule: "zero-width", severity: "low" });
    expect(detectHidden("Some\u200B text.", prose)).toEqual([]);
  });

  it("reports long zero-width runs that do not decode", () => {
    const [f] = detectHidden("x\u200B\u200B\u200D\u2060\u200By", prose);
    expect(f).toMatchObject({ rule: "zero-width-run", severity: "medium" });
  });

  it("returns nothing for plain text", () => {
    expect(detectHidden("plain ascii\nwith ünïcödé and 中文", code)).toEqual([]);
  });
});
