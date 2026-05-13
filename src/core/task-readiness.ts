// src/core/task-readiness.ts
//
// Spec: wikis/_meta/specs/2026-05-13-task-ready-gate-design.md §4.
// Pure regex checker — given a task body, return readiness verdict.
// Loose by design: rewards any task written in a recognizably-grounded
// style, only rejects one-paragraph captures and pure-decision tasks.

export type TaskReadinessSignal = "files" | "scope" | "out_of_scope" | "verification";

export type TaskReadinessResult =
  | { ready: true }
  | { ready: false; missing: TaskReadinessSignal[] };

const FILE_RE = /\b[\w./-]+\.(?:ts|tsx|js|jsx|md|json|sql|py|go|rs|yaml|yml|toml|sh|html|css|scss|prisma)\b(?::\d+(?:-\d+)?)?/i;

const SCOPE_KEYWORDS = "scope|implementation|approach|diagnose|requirements";
const SCOPE_RE = new RegExp(
  `^(?:` +
    `##\\s+[^\\n]*\\b(?:${SCOPE_KEYWORDS})\\b` +
  `|` +
    `\\*\\*[^*\\n]*\\b(?:${SCOPE_KEYWORDS})\\b[^*\\n]*\\*\\*` +
  `|` +
    `(?:scope|requirements):` +
  `)`,
  "im",
);

const OUT_OF_SCOPE_RE = /(?:^##\s+out[\s-]of[\s-]scope\b)|(?:^\*\*out[\s-]of[\s-]scope:?\*\*)|(?:out of scope)/im;

const VERIFICATION_KEYWORDS = "verification|acceptance|done\\s+means|done\\s+when|acceptance\\s+criteria";
const VERIFICATION_RE = new RegExp(
  `^(?:` +
    `##\\s+(?:${VERIFICATION_KEYWORDS})\\b` +
  `|` +
    `\\*\\*(?:${VERIFICATION_KEYWORDS}):?\\*\\*` +
  `)`,
  "im",
);

export function checkTaskReadiness(body: string): TaskReadinessResult {
  const missing: TaskReadinessSignal[] = [];
  if (!FILE_RE.test(body)) missing.push("files");
  if (!SCOPE_RE.test(body)) missing.push("scope");
  if (!OUT_OF_SCOPE_RE.test(body)) missing.push("out_of_scope");
  if (!VERIFICATION_RE.test(body)) missing.push("verification");
  return missing.length === 0 ? { ready: true } : { ready: false, missing };
}
