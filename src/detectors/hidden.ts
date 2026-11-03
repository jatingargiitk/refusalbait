import type { Detector, Finding, FileContext } from "../types.ts";
import { LineIndex, hex, isPictographic, printable } from "../text.ts";

const isTag = (cp: number) => cp >= 0xe0000 && cp <= 0xe007f;
const isVS = (cp: number) => (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef);
const isBidi = (cp: number) => (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);
const isMark = (cp: number) => cp === 0x200e || cp === 0x200f;
const isZeroWidth = (cp: number) =>
  cp === 0x200b || cp === 0x200c || cp === 0x200d || (cp >= 0x2060 && cp <= 0x2064) || cp === 0xfeff || cp === 0x180e;

const isHidden = (cp: number) => isTag(cp) || isVS(cp) || isBidi(cp) || isMark(cp) || isZeroWidth(cp);

interface Char {
  cp: number;
  offset: number;
}

/** Unicode tag characters mirror ASCII: U+E0041 is a hidden "A". */
export function decodeTags(cps: number[]): string {
  return cps
    .filter((cp) => cp >= 0xe0020 && cp <= 0xe007e)
    .map((cp) => String.fromCharCode(cp - 0xe0000))
    .join("");
}

/**
 * "Variation selector smuggling": each selector carries one byte
 * (U+FE00..FE0F = 0..15, U+E0100..E01EF = 16..255).
 */
export function decodeVariationSelectors(cps: number[]): string {
  const bytes = cps.map((cp) => (cp <= 0xfe0f ? cp - 0xfe00 : cp - 0xe0100 + 16));
  return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
}

/** Zero-width binary: two alternating invisible characters as 0/1 bits, 8 per byte. */
export function decodeZeroWidthBinary(cps: number[]): string | undefined {
  const distinct = [...new Set(cps)];
  if (distinct.length !== 2 || cps.length < 16 || cps.length % 8 !== 0) return undefined;
  let best: string | undefined;
  for (const one of distinct) {
    const bytes: number[] = [];
    for (let i = 0; i < cps.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | (cps[i + j] === one ? 1 : 0);
      bytes.push(b);
    }
    const s = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
    if (printableRatio(s) > 0.9 && (!best || printableRatio(s) > printableRatio(best))) best = s;
  }
  return best;
}

function printableRatio(s: string): number {
  if (!s) return 0;
  let ok = 0;
  for (const ch of s) if (/[\p{L}\p{N}\p{P}\p{Zs}\n]/u.test(ch)) ok++;
  return ok / [...s].length;
}

/** Flag emoji like England's (U+1F3F4 + tag letters + U+E007F) use tags legitimately. */
function isFlagSequence(prev: string | undefined, tags: number[]): boolean {
  if (prev !== "\u{1F3F4}") return false;
  if (tags[tags.length - 1] !== 0xe007f) return false;
  return tags.slice(0, -1).every((cp) => (cp >= 0xe0061 && cp <= 0xe007a) || (cp >= 0xe0030 && cp <= 0xe0039));
}

function bidiMessage(cps: number[]): string {
  const list = [...new Set(cps)].sort((a, b) => a - b).map(hex).join(", ");
  return `bidirectional control characters (${list}): the text displays in a different order than it is parsed (Trojan Source)`;
}

const LETTER_NON_ASCII = /[^\p{ASCII}]/u;

export const detectHidden: Detector = (text: string, ctx: FileContext): Finding[] => {
  const findings: Finding[] = [];
  const idx = new LineIndex(text);
  const chars: Char[] = [];
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    chars.push({ cp, offset: i });
    i += cp > 0xffff ? 2 : 1;
  }

  const add = (offset: number, f: Omit<Finding, "detector" | "line" | "column">) => {
    findings.push({ detector: "hidden-unicode", ...idx.locate(offset), ...f });
  };
  const bidiSeen = new Map<number, { finding: Finding; cps: Set<number> }>();
  const mergeBidi = (offset: number, cps: number[]): boolean => {
    const { line } = idx.locate(offset);
    const prior = bidiSeen.get(line);
    if (prior) {
      cps.forEach((cp) => prior.cps.add(cp));
      prior.finding.message = bidiMessage([...prior.cps]);
      return true;
    }
    return false;
  };

  for (let i = 0; i < chars.length; i++) {
    if (!isHidden(chars[i]!.cp)) continue;
    let j = i;
    while (j < chars.length && isHidden(chars[j]!.cp)) j++;
    const run = chars.slice(i, j);
    const prev = i > 0 ? String.fromCodePoint(chars[i - 1]!.cp) : undefined;
    const next = j < chars.length ? String.fromCodePoint(chars[j]!.cp) : undefined;
    const before = findings.length;
    classifyRun(run, prev, next, ctx, add, mergeBidi);
    const bidiFinding = findings.slice(before).find((f) => f.rule === "bidi-control");
    if (bidiFinding) bidiSeen.set(bidiFinding.line, { finding: bidiFinding, cps: new Set(run.map((c) => c.cp).filter(isBidi)) });
    i = j - 1;
  }
  return findings;
};

function classifyRun(
  run: Char[],
  prev: string | undefined,
  next: string | undefined,
  ctx: FileContext,
  add: (offset: number, f: Omit<Finding, "detector" | "line" | "column">) => void,
  merge: (offset: number, cps: number[]) => boolean,
): void {
  const start = run[0]!.offset;
  const cps = run.map((c) => c.cp);
  const firstOf = (pred: (cp: number) => boolean) => run.find((c) => pred(c.cp))!.offset;

  const tags = cps.filter(isTag);
  if (tags.length > 0 && !isFlagSequence(prev, tags)) {
    const decoded = decodeTags(tags);
    add(firstOf(isTag), {
      rule: "unicode-tags",
      severity: "high",
      message: `${tags.length} invisible Unicode tag characters` + (decoded ? " hiding ASCII text" : ""),
      decoded: decoded || undefined,
    });
  }

  const vs = cps.filter(isVS);
  // One selector after a character is normal emoji/CJK presentation. Several in a row carry data.
  if (vs.length >= 2) {
    const decoded = decodeVariationSelectors(vs);
    const readable = printableRatio(decoded) > 0.8 && decoded.trim().length >= 2;
    add(firstOf(isVS), {
      rule: "variation-selector-smuggling",
      severity: readable ? "high" : "medium",
      message: `${vs.length} variation selectors in a row` + (readable ? " decoding to hidden text" : " (possible byte smuggling)"),
      decoded: readable ? decoded : undefined,
    });
  }

  const bidi = cps.filter(isBidi);
  if (bidi.length > 0) {
    // Trojan Source lines usually carry several controls; report each line once.
    if (merge(firstOf(isBidi), bidi)) return;
    add(firstOf(isBidi), {
      rule: "bidi-control",
      severity: ctx.prose ? "medium" : "high",
      message: bidiMessage(bidi),
    });
  }

  const zw = run.filter((c) => isZeroWidth(c.cp) && !(c.cp === 0xfeff && c.offset === 0));
  if (zw.length > 0) {
    const zwCps = zw.map((c) => c.cp);
    // ZWJ inside emoji (👩‍💻) and ZWNJ/ZWJ inside non-Latin words (Persian, Indic) are legitimate.
    const joinerOnly = zwCps.every((cp) => cp === 0x200d || cp === 0x200c);
    const legitJoin =
      joinerOnly &&
      zw.length <= 2 &&
      ((isPictographic(prev) || isPictographic(next)) ||
        (prev !== undefined && next !== undefined && LETTER_NON_ASCII.test(prev) && LETTER_NON_ASCII.test(next)));
    if (!legitJoin) {
      const decoded = decodeZeroWidthBinary(zwCps);
      if (decoded) {
        add(zw[0]!.offset, {
          rule: "zero-width-binary",
          severity: "high",
          message: `${zw.length} zero-width characters encoding hidden text as binary`,
          decoded,
        });
      } else if (zw.length >= 4) {
        add(zw[0]!.offset, {
          rule: "zero-width-run",
          severity: "medium",
          message: `run of ${zw.length} zero-width characters`,
          excerpt: printable(String.fromCodePoint(...zwCps)),
        });
      } else if (!ctx.prose) {
        add(zw[0]!.offset, {
          rule: "zero-width",
          severity: "low",
          message: `zero-width character ${[...new Set(zwCps)].map(hex).join(", ")} in code`,
        });
      }
    }
  }

  if (!ctx.prose && cps.some(isMark) && bidi.length === 0) {
    add(start, {
      rule: "direction-mark",
      severity: "info",
      message: "left-to-right/right-to-left mark in code",
    });
  }
}
