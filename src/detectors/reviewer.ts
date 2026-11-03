import type { Detector, Finding, FileContext } from "../types.ts";
import { LineIndex, printable } from "../text.ts";

/** Who the note is addressed to. "AI"/"LLM"/"GPT" are matched case-sensitively to avoid ordinary words. */
const ADDRESSEE_CS = /\b(?:AI|A\.I\.|LLMs?|GPT(?:-\d[\w.]*)?)\b/;
const ADDRESSEE_CI =
  /\b(?:large\s+language\s+models?|language\s+models?|claude|chatgpt|gemini|copilot|codex|ai\s+(?:agents?|assistants?|reviewers?|auditors?|scanners?|models?|tools?)|(?:automated|security|code)\s+(?:reviewers?|scanners?|auditors?|analy[sz]ers?)|reviewer\s+bots?)\b/i;

/** What the note tells the reader to do. */
const VERB = "(?:analy[sz]e|review|scan|audit|inspect|flag|report|read|decompile|deobfuscate|summari[sz]e|look\\s+at|examine)";
const DIRECTIVE = new RegExp(
  [
    `\\bskip(?:ping)?\\s+(?:over\\s+)?(?:this|the\\s+following)\\s+(?:file|function|module|code|section|block|script)`,
    `\\b(?:do\\s+not|don'?t|never|must\\s+not|should\\s+not)\\s+${VERB}`,
    `\\bignore\\s+(?:this|the\\s+following)\\s+(?:file|function|module|code|section|block|script)`,
    `\\b(?:this|the\\s+following)\\s+(?:file|function|module|code|script|package)\\s+(?:is|are)\\s+(?:safe|benign|harmless|trusted|clean|audited|verified)`,
    `\\b(?:mark|treat|classify|report|consider)\\s+(?:this|it)(?:\\s+\\w+)?\\s+as\\s+(?:safe|benign|clean|harmless|trusted)`,
    `\\bno\\s+(?:security\\s+)?(?:issues|vulnerabilities|problems)\\s+(?:here|in\\s+this)`,
    `\\bstop\\s+(?:analy[sz]ing|reading|reviewing|scanning)`,
    `\\b(?:you\\s+must|please)\\s+refuse\\b`,
    `\\brefuse\\s+to\\s+(?:analy[sz]e|review|continue|summari[sz]e|deobfuscate)`,
  ].join("|"),
  "i",
);

/** Files whose whole purpose is instructing AI agents. */
const AGENT_FILE = /(?:^|\/)(?:AGENTS\.md|CLAUDE\.md|GEMINI\.md|\.cursorrules|\.windsurfrules|copilot-instructions\.md|\.cursor\/rules\/.*|\.clinerules.*)$/i;

const hasAddressee = (s: string) => ADDRESSEE_CS.test(s) || ADDRESSEE_CI.test(s);

export const detectReviewerInstructions: Detector = (text: string, ctx: FileContext): Finding[] => {
  const findings: Finding[] = [];
  const idx = new LineIndex(text);
  const agentFile = AGENT_FILE.test(ctx.path);
  // Minified files are one huge line; look at a window around each directive instead of whole lines.
  const re = new RegExp(DIRECTIVE.source, "gi");
  let lastLine = -1;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const { line, column } = idx.locate(m.index);
    if (line === lastLine) continue;
    lastLine = line;
    const lineStart = m.index - (column - 1);
    const winStart = Math.max(lineStart, m.index - 200);
    let winEnd = text.indexOf("\n", m.index);
    if (winEnd < 0) winEnd = text.length;
    winEnd = Math.min(winEnd, m.index + m[0].length + 200);
    // Allow the addressee on the line before or after ("// Note for AI reviewers:\n// skip this file").
    const ctxStart = Math.max(0, text.lastIndexOf("\n", Math.max(0, lineStart - 2)));
    const nextNl = text.indexOf("\n", winEnd + 1);
    const ctxEnd = nextNl < 0 ? text.length : nextNl;
    const near = text.slice(Math.max(ctxStart, winStart - 200), Math.min(ctxEnd, winEnd + 200));
    const addressed = hasAddressee(near);
    const excerpt = printable(text.slice(winStart, winEnd).trim(), 140);
    if (agentFile) {
      findings.push({
        detector: "reviewer-instruction",
        rule: "agent-file-directive",
        severity: "info",
        line,
        column,
        message: `review-suppressing instruction in an agent instructions file: "${printable(m[0], 60)}"`,
        excerpt,
      });
    } else if (addressed) {
      findings.push({
        detector: "reviewer-instruction",
        rule: "ai-reviewer-directive",
        severity: "high",
        line,
        column,
        message: `instruction aimed at AI reviewers: "${printable(m[0], 60)}"`,
        excerpt,
      });
    } else {
      findings.push({
        detector: "reviewer-instruction",
        rule: "review-suppression",
        // Linters and parsers say "don't report" all the time; without an addressee it is only a hint.
        severity: "info",
        line,
        column,
        message: `review-suppressing instruction: "${printable(m[0], 60)}"`,
        excerpt,
      });
    }
  }
  return findings;
};
