import type { Detector, Finding, FileContext, Severity } from "../types.ts";
import { LineIndex, printable } from "../text.ts";

interface Rule {
  rule: string;
  re: RegExp;
  family: string;
  /** Jailbreak phrases are worse than bare template tokens. */
  phrase?: boolean;
}

const RULES: Rule[] = [
  { rule: "chatml-token", family: "ChatML", re: /<\|(?:im_start|im_end|im_sep|endoftext|system|user|assistant)\|>/g },
  { rule: "llama-token", family: "Llama", re: /<\|(?:begin_of_text|start_header_id|end_header_id|eot_id|eom_id|python_tag)\|>|\[\/?INST\]|<<\/?SYS>>/g },
  { rule: "cohere-token", family: "Cohere", re: /<\|(?:START_OF_TURN_TOKEN|END_OF_TURN_TOKEN|SYSTEM_TOKEN|USER_TOKEN|CHATBOT_TOKEN)\|>/g },
  { rule: "gemma-token", family: "Gemma", re: /<(?:start_of_turn|end_of_turn)>/g },
  { rule: "thinking-tag", family: "reasoning", re: /<\/?(?:thinking|think|reasoning|scratchpad)>/g },
  { rule: "anthropic-turn", family: "Anthropic", re: /\n\n(?:Human|Assistant):/g },
  {
    rule: "ignore-instructions",
    family: "jailbreak",
    phrase: true,
    re: /\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+)?(?:of\s+)?(?:the\s+|your\s+)?(?:previous|prior|above|earlier|preceding|safety)\s+(?:instructions|rules|guidelines|prompts?)\b/gi,
  },
  { rule: "system-override", family: "jailbreak", phrase: true, re: /\bSYSTEM\s+(?:OVERRIDE|PROMPT\s+OVERRIDE)\b/gi },
  {
    rule: "mode-switch",
    family: "jailbreak",
    phrase: true,
    re: /\b(?:you\s+are\s+now\s+(?:in\s+)?(?:an?\s+)?(?:unrestricted|uncensored|jailbroken|DAN)\b|(?:unrestricted|uncensored|jailbreak|god)\s+mode\b|developer\s+mode\s+(?:enabled|activated|on)\b)/gi,
  },
];

/** Paths where template tokens are expected (tokenizers, prompt templates, LLM client code). */
const LLM_PATH = /(?:tokeni[sz]|chat[_-]?template|jinja|prompt|llm|openai|anthropic|transformers|ollama|langchain)/i;

export const detectChatTokens: Detector = (text: string, ctx: FileContext): Finding[] => {
  const findings: Finding[] = [];
  const idx = new LineIndex(text);
  const expected = LLM_PATH.test(ctx.path);
  for (const r of RULES) {
    const seen = new Map<string, Finding>();
    for (let m = r.re.exec(text); m; m = r.re.exec(text)) {
      const at = r.rule === "anthropic-turn" ? m.index + 2 : m.index;
      const token = m[0].trim();
      const key = token.toLowerCase();
      const prev = seen.get(key);
      if (prev) {
        const n = Number(/\((\d+) times\)$/.exec(prev.message)?.[1] ?? 1) + 1;
        prev.message = prev.message.replace(/ \(\d+ times\)$/, "") + ` (${n} times)`;
        continue;
      }
      let severity: Severity;
      if (r.phrase) severity = ctx.prose ? "medium" : "high";
      else if (expected) severity = "info";
      else severity = ctx.prose ? "low" : "medium";
      const f: Finding = {
        detector: "chat-token",
        rule: r.rule,
        severity,
        ...idx.locate(at),
        message: r.phrase
          ? `jailbreak-style instruction "${printable(token, 60)}"`
          : `${r.family} chat-template token ${printable(token, 40)} in ${ctx.prose ? "a document" : "source"}` +
            (expected ? " (expected in LLM tooling)" : ""),
        excerpt: printable(token, 80),
      };
      seen.set(key, f);
      findings.push(f);
    }
    r.re.lastIndex = 0;
  }
  return findings;
};
