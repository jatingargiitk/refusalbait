import type { Detector, Finding, FileContext, Severity } from "../types.ts";
import { AMPLIFIERS, CENSORSHIP, PHRASES, STRONG, WEAK, type BaitCategory } from "../lexicon.ts";
import { LineIndex, printable } from "../text.ts";

interface Word {
  w: string;
  start: number;
  end: number;
  token: number;
}

/** Splits identifiers and prose into lowercase words, keeping offsets and the token each came from. */
export function words(text: string): Word[] {
  const out: Word[] = [];
  const tokenRe = /[A-Za-z0-9_$]+/g;
  const partRe = /[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|\d+/g;
  let token = 0;
  for (let m = tokenRe.exec(text); m; m = tokenRe.exec(text)) {
    token++;
    for (let p = partRe.exec(m[0]); p; p = partRe.exec(m[0])) {
      if (/^\d+$/.test(p[0])) continue;
      const start = m.index + p.index;
      out.push({ w: p[0].toLowerCase(), start, end: start + p[0].length, token });
    }
    partRe.lastIndex = 0;
  }
  return out;
}

/** Splits an identifier like computeRicinLethalDosage into ["compute", "ricin", "lethal", "dosage"]. */
export function splitIdentifier(id: string): string[] {
  return words(id).map((w) => w.w);
}

const DANGEROUS_CALL = /\beval\s*\(|\bnew\s+Function\s*\(|\bFunction\s*\(\s*["'`]|child_process|\bexecSync\s*\(|\batob\s*\(/g;

const WINDOW = 60;
const BUMP: Record<Severity, Severity> = { info: "info", low: "medium", medium: "high", high: "high" };

interface Hit {
  term: string;
  category: BaitCategory;
  start: number;
  end: number;
  severity: Severity;
  reason: string;
}

export const detectBait: Detector = (text: string, ctx: FileContext): Finding[] => {
  // Prose (docs, READMEs) legitimately discusses these topics; we only look at code.
  if (ctx.prose) return [];
  const ws = words(text);
  const hits: Hit[] = [];

  const amplifierNear = (i: number, sameToken: boolean): Word | undefined => {
    const me = ws[i]!;
    const ok = (j: number) => sameToken || !text.slice(Math.min(ws[j]!.start, me.start), Math.max(ws[j]!.end, me.end)).includes("\n");
    for (let j = i - 1; j >= 0 && me.start - ws[j]!.end <= WINDOW; j--) {
      if (ok(j) && AMPLIFIERS.has(ws[j]!.w) && (!sameToken || ws[j]!.token === me.token)) return ws[j];
    }
    for (let j = i + 1; j < ws.length && ws[j]!.start - me.end <= WINDOW; j++) {
      if (ok(j) && AMPLIFIERS.has(ws[j]!.w) && (!sameToken || ws[j]!.token === me.token)) return ws[j];
    }
    return undefined;
  };

  for (let i = 0; i < ws.length; i++) {
    const cur = ws[i]!;
    const nxt = ws[i + 1];
    let term: string | undefined;
    let category: BaitCategory | undefined;
    let end = cur.end;
    let strong = false;
    if (nxt && nxt.start - cur.end <= 2) {
      const phrase = `${cur.w} ${nxt.w}`;
      if (Object.hasOwn(PHRASES, phrase)) {
        term = phrase;
        category = PHRASES[phrase];
        end = nxt.end;
        strong = true;
      }
    }
    if (!term && Object.hasOwn(STRONG, cur.w)) {
      term = cur.w;
      category = STRONG[cur.w];
      strong = true;
    }
    if (!term && Object.hasOwn(WEAK, cur.w)) {
      term = cur.w;
      category = WEAK[cur.w];
    }
    if (!term || !category) continue;

    const inToken = amplifierNear(i, true);
    const nearby = inToken ?? amplifierNear(i, false);
    let severity: Severity;
    let reason: string;
    if (inToken) {
      severity = "high";
      reason = `combined with "${inToken.w}" in one identifier`;
    } else if (nearby && strong) {
      severity = "high";
      reason = `next to "${nearby.w}"`;
    } else if (strong) {
      severity = "medium";
      reason = "in code";
    } else {
      continue;
    }
    hits.push({ term, category, start: cur.start, end, severity, reason });
  }

  // Context: packed code, or bait sitting near eval/Function/child_process, looks deliberate.
  const dangerous: number[] = [];
  for (let m = DANGEROUS_CALL.exec(text); m; m = DANGEROUS_CALL.exec(text)) dangerous.push(m.index);
  DANGEROUS_CALL.lastIndex = 0;
  for (const h of hits) {
    const nearDanger = dangerous.some((d) => Math.abs(d - h.start) < 400);
    if (ctx.minified || nearDanger) {
      h.severity = BUMP[h.severity];
      h.reason += ctx.minified ? ", in minified code" : ", near eval/Function/child_process";
    }
  }

  // One finding per distinct identifier, with an occurrence count.
  const idx = new LineIndex(text);
  const byToken = new Map<string, { hit: Hit; count: number; tokenText: string; tokenStart: number }>();
  for (const h of hits) {
    const { tokenText, tokenStart } = tokenAround(text, h.start);
    const key = `${h.term}|${tokenText}`;
    const prev = byToken.get(key);
    if (prev) {
      prev.count++;
      if (rank(h.severity) > rank(prev.hit.severity)) prev.hit = h;
    } else byToken.set(key, { hit: h, count: 1, tokenText, tokenStart });
  }
  const findings: Finding[] = [];
  for (const { hit, count, tokenText, tokenStart } of byToken.values()) {
    findings.push({
      detector: "refusal-bait",
      rule: `bait-${hit.category}`,
      severity: hit.severity,
      ...idx.locate(tokenStart),
      message: `${hit.category} term "${hit.term}" ${hit.reason}` + (count > 1 ? ` (${count} times)` : ""),
      excerpt: printable(tokenText, 80),
    });
  }

  const lower = text.toLowerCase();
  for (const term of CENSORSHIP) {
    const at = lower.indexOf(term);
    if (at >= 0) {
      findings.push({
        detector: "refusal-bait",
        rule: "censorship-tripwire",
        severity: "info",
        ...idx.locate(at),
        message: `politically censored term "${term}" in code (trips some models' filters)`,
        excerpt: printable(text.slice(at, at + term.length), 80),
      });
    }
  }
  return findings;
};

function rank(s: Severity): number {
  return { info: 0, low: 1, medium: 2, high: 3 }[s];
}

function tokenAround(text: string, at: number): { tokenText: string; tokenStart: number } {
  let s = at;
  let e = at;
  while (s > 0 && /[A-Za-z0-9_$]/.test(text[s - 1]!)) s--;
  while (e < text.length && /[A-Za-z0-9_$]/.test(text[e]!)) e++;
  return { tokenText: text.slice(s, e), tokenStart: s };
}
