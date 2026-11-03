export type Severity = "high" | "medium" | "low" | "info";

export type DetectorId = "hidden-unicode" | "refusal-bait" | "chat-token" | "reviewer-instruction";

export interface Finding {
  detector: DetectorId;
  /** Short machine-readable rule id, e.g. "unicode-tags". */
  rule: string;
  severity: Severity;
  /** 1-based line and column (column counts UTF-16 code units, like editors and SARIF). */
  line: number;
  column: number;
  message: string;
  /** The matched text, made safe to print (invisible characters shown as <U+XXXX>). */
  excerpt?: string;
  /** For hidden payloads: the text the invisible characters decode to. */
  decoded?: string;
}

export interface FileContext {
  /** Path relative to the scan root, with forward slashes. */
  path: string;
  /** True when the file looks minified or packed (very long lines). */
  minified: boolean;
  /** True for prose files (Markdown, txt) as opposed to code. */
  prose: boolean;
}

export type Detector = (text: string, ctx: FileContext) => Finding[];

export const SEVERITY_ORDER: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3 };
