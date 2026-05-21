import { readFileSync } from "node:fs";

/**
 * A lint issue emitted by this rule. Shaped like `Diagnostic` from
 * `core/lint.ts` but adds an optional `file` field for caller-side context
 * since this rule operates on arbitrary file paths rather than vault pages.
 */
export interface LintIssue {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  file?: string;
  page_id?: string;
  wiki?: string;
}

// Tools that no longer accept agent_id in their input schemas (v0.4 cutover).
// Callers passing agent_id to these tools will fail Zod parse at runtime.
const REMOVED_FROM = new Set([
  "vault_channel-post",
  "vault_agent-journal",
  "vault_task-claim",
  "vault_task-update",
  "vault_task-create",
  "vault_claim",
  "vault_agent-memory",
]);

/**
 * Scans a single .ts or .md file for callers that pass `agent_id` to write
 * tools that no longer accept it (v0.4 server-mode migration). Mirrors spec §11.2.
 *
 * Returns AGENT_ID_INPUT_LEAK (warning) for each affected tool found in the file.
 */
export function checkAgentIdLeak(filePath: string): LintIssue[] {
  if (!filePath.endsWith(".ts") && !filePath.endsWith(".md")) return [];
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  const issues: LintIssue[] = [];
  for (const tool of REMOVED_FROM) {
    const idx = content.indexOf(tool);
    if (idx < 0) continue;
    const window = content.slice(idx, idx + 200);
    if (/agent_id\s*[:=]/.test(window)) {
      issues.push({
        code: "AGENT_ID_INPUT_LEAK",
        severity: "warning",
        message: `${tool} no longer accepts agent_id input — server stamps from principal`,
        file: filePath,
      });
    }
  }
  return issues;
}
