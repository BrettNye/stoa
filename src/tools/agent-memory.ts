// vault-mcp/src/tools/agent-memory.ts
//
// `vault_agent-memory` MCP tool — identity-keyed working context for an agent.
//
// Spec: wikis/_meta/specs/2026-05-13-agent-memory-design.md §5.1 (input schema),
// §8.3 (error semantics). All error-semantics rows are handled by the core
// function; this tool layer is a thin adapter.
//
// Registration: add to allTools in src/tools/index.ts.

import { z } from "zod";
import { agentMemory } from "../core/agent-memory.js";

const Input = z.object({
  agent_id: z.string().min(1),
  task: z.string().optional(),
  tags: z.array(z.string()).optional(),
  scope_wiki: z.array(z.string()).optional(),
  token_budget: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional(),
  detail: z.enum(["summary", "truncated", "full"]).optional(),
  include_questions: z.boolean().optional(),
});

export const agentMemoryTool = {
  name: "vault_agent-memory",
  description:
    "Identity-keyed working context for an agent: ranked, scope-aware, decay-aware claims relevant to a task. Read-only. Falls back to disk walk when the claims sidecar is missing or stale. See spec wikis/_meta/specs/2026-05-13-agent-memory-design.md.",
  inputSchema: Input,
  handler: async (
    input: z.infer<typeof Input>,
    ctx: { vaultPath: string; defaultWiki?: string },
  ) => {
    // Normalize agent_id: strip "agent:" or "profile-" prefix; keep bare form.
    const agent_id = input.agent_id
      .replace(/^agent:/, "")
      .replace(/^profile-/, "");
    return agentMemory(ctx.vaultPath, { ...input, agent_id });
  },
};
