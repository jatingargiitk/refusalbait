/** Maps string offsets to 1-based line/column. */
export class LineIndex {
  private readonly starts: number[] = [0];

  constructor(text: string) {
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) this.starts.push(i + 1);
    }
  }

  locate(offset: number): { line: number; column: number } {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - this.starts[lo]! + 1 };
  }
}

export function hex(cp: number): string {
  return "U+" + cp.toString(16).toUpperCase().padStart(4, "0");
}

/** True for code points that render as nothing or reorder text. */
export function isInvisible(cp: number): boolean {
  return (
    (cp >= 0xe0000 && cp <= 0xe007f) || // tags
    (cp >= 0xfe00 && cp <= 0xfe0f) || // variation selectors
    (cp >= 0xe0100 && cp <= 0xe01ef) || // variation selectors supplement
    (cp >= 0x200b && cp <= 0x200f) || // zero-width + LRM/RLM
    (cp >= 0x202a && cp <= 0x202e) || // bidi embeddings/overrides
    (cp >= 0x2060 && cp <= 0x2064) || // word joiner, invisible operators
    (cp >= 0x2066 && cp <= 0x2069) || // bidi isolates
    cp === 0xfeff ||
    cp === 0x180e ||
    cp === 0x00ad
  );
}

/**
 * Makes a string safe to print in a terminal: invisible and control
 * characters become <U+XXXX>, and long strings are shortened.
 */
export function printable(s: string, max = 120): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (isInvisible(cp) || (cp < 0x20 && cp !== 9) || cp === 0x7f) out += `<${hex(cp)}>`;
    else out += ch;
  }
  if (out.length > max) out = out.slice(0, max - 1) + "…";
  return out;
}

/** Shows decoded hidden text with control characters escaped, newlines kept as \n. */
export function printableDecoded(s: string, max = 400): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp === 10) out += "\\n";
    else if (isInvisible(cp) || cp < 0x20 || cp === 0x7f) out += `<${hex(cp)}>`;
    else out += ch;
  }
  if (out.length > max) out = out.slice(0, max - 1) + "…";
  return out;
}

const PICTOGRAPHIC = /\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}/u;

export function isPictographic(ch: string | undefined): boolean {
  return ch !== undefined && PICTOGRAPHIC.test(ch);
}
