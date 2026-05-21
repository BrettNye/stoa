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
import type { ToolScope } from "../auth/types.js";
import { agentMemory } from "../core/agent-memory.js";

const Input = z.object({
  // agent_id REMOVED — server stamps from principal
  task: z.string().optional(),
  tags: z.array(z.string()).optional(),
  scope_wiki: z.array(z.string()).optional(),
  // wiki is the auth-scope hint; optional — axis returns "*" when absent
  wiki: z.string().optional(),
  token_budget: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional(),
  detail: z.enum(["summary", "truncated", "full"]).optional(),
  include_questions: z.boolean().optional(),
});

const scope: ToolScope = {
  axis: (input: any) => {
    const wiki = (input as { wiki?: string }).wiki;
    return wiki ? `wikis/${wiki}` : "*";
  },
};

export const agentMemoryTool = {
  name: "vault_agent-memory",
  description:
    "Identity-keyed working context for an agent: ranked, scope-aware, decay-aware claims relevant to a task. Read-only. Falls back to disk walk when the claims sidecar is missing or stale. See spec wikis/_meta/specs/2026-05-13-agent-memory-design.md.",
  inputSchema: Input,
  scope,
  handler: async (
    input: z.infer<typeof Input>,
    ctx: { vaultPath: string; defaultWiki?: string; principal?: { agent_id: string } },
  ) => {
    // agent_id now comes from principal; normalize: strip "agent:" or "profile-" prefix.
    const raw_agent_id = ctx.principal?.agent_id ?? "stoa-local";
    const agent_id = raw_agent_id
      .replace(/^agent:/, "")
      .replace(/^profile-/, "");
    // Pass only the fields agentMemory accepts (wiki is axis-only metadata)
    const { wiki: _wiki, ...coreInput } = input;
    return agentMemory(ctx.vaultPath, { ...coreInput, agent_id });
  },
};
