// src/cli/commands/agent-memory.ts
//
// Commander sub-command: `vault agent-memory <agent_id>`
// Surfaces `agentMemory()` from core for shell users.
// Spec: wikis/_meta/specs/2026-05-13-agent-memory-design.md §5.1

import { Command } from "commander";
import { agentMemory, AgentMemoryResult } from "../../core/agent-memory.js";
import { getCtx } from "../_ctx.js";

export function registerAgentMemory(p: Command): void {
  p.command("agent-memory <agent_id>")
    .description("Pull this agent's ranked memory of relevant claims (read-only).")
    .option("--task <task_id>", "derive scope from a task page")
    .option("--tags <list>", "comma-separated tag scope", (v: string) => v.split(","))
    .option("--scope-wiki <list>", "comma-separated wiki scope", (v: string) => v.split(","))
    .option("--token-budget <n>", "token budget cap", (v: string) => parseInt(v, 10))
    .option("--limit <n>", "max claims to return (default 10)", (v: string) => parseInt(v, 10))
    .option("--detail <level>", "summary | truncated | full", "truncated")
    .option("--include-questions", "also return open questions tagged with agent")
    .option("--json", "emit JSON instead of pretty markdown")
    .action(async (agent_id: string, opts: Record<string, unknown>) => {
      const ctx = getCtx();
      const result = agentMemory(ctx.vaultPath, {
        agent_id,
        task: opts.task as string | undefined,
        tags: opts.tags as string[] | undefined,
        scope_wiki: opts.scopeWiki as string[] | undefined,
        token_budget: opts.tokenBudget as number | undefined,
        limit: opts.limit as number | undefined,
        detail: opts.detail as "summary" | "truncated" | "full" | undefined,
        include_questions: opts.includeQuestions as boolean | undefined,
      });
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(renderMarkdown(result));
      }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Markdown renderer
// ─────────────────────────────────────────────────────────────────────────────

function renderMarkdown(r: AgentMemoryResult): string {
  const lines: string[] = [];

  // Title
  lines.push(`## Agent Memory: \`${r.agent_id}\``);
  lines.push("");

  // Scope summary
  const scopeParts: string[] = [];
  if (r.scope_used.tags.length > 0) {
    scopeParts.push(`tags: ${r.scope_used.tags.join(", ")}`);
  }
  if (r.scope_used.scope_wiki.length > 0) {
    scopeParts.push(`scope_wiki: ${r.scope_used.scope_wiki.join(", ")}`);
  }
  if (r.scope_used.profile.length > 0) {
    scopeParts.push(`profile: ${r.scope_used.profile.join(", ")}`);
  }
  const scopeLine = scopeParts.length > 0 ? scopeParts.join(" | ") : "no explicit scope";
  lines.push(`**Scope used:** ${scopeLine}`);
  lines.push(`**Pool size:** ${r.total_pool_size}${r.truncated ? " (truncated)" : ""}`);
  lines.push("");

  // Claims
  if (r.claims.length === 0) {
    lines.push(`No relevant memory for \`${r.agent_id}\` in this scope.`);
  } else {
    lines.push("### Claims");
    lines.push("");
    for (const c of r.claims) {
      lines.push(`#### \`${c.id}\``);
      lines.push(`- **Summary:** ${c.summary}`);
      lines.push(`- **Effective confidence:** ${c.effective_confidence.toFixed(3)}`);
      lines.push(`- **Score:** ${c.score.toFixed(3)}`);
      if (c.body) {
        lines.push(`- **Body:** ${c.body}`);
      }
      lines.push("");
    }
  }

  // Questions (optional)
  if (r.questions && r.questions.length > 0) {
    lines.push("### Open Questions");
    lines.push("");
    for (const q of r.questions) {
      lines.push(`- \`${q.id}\`: ${q.title}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
