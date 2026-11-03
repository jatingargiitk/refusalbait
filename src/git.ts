import { execFileSync } from "node:child_process";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
}

/**
 * Files under `dir` that were added, copied, modified or renamed relative to `ref`
 * (including uncommitted changes), plus untracked files that are not ignored.
 * Paths are relative to `dir` with forward slashes.
 */
export function changedFiles(dir: string, ref: string): string[] {
  let changed: string;
  try {
    changed = git(dir, ["diff", "--name-only", "-z", "--relative", "--diff-filter=ACMR", ref, "--"]);
  } catch (e) {
    const stderr = String((e as { stderr?: unknown }).stderr ?? "").trim();
    throw new Error(`git diff against ${ref} failed${stderr ? `: ${stderr.split("\n")[0]}` : ""}`, { cause: e });
  }
  const untracked = git(dir, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const all = new Set([...changed.split("\0"), ...untracked.split("\0")].filter(Boolean));
  return [...all].sort();
}
