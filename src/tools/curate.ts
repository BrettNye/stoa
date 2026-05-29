// src/tools/curate.ts
//
// MCP tool: vault_curate (spec §4.4, §4.6)
//
// Advances page status on checkable evidence:
//   - promote pages with landed PRs (PROMOTE_LANDED)
//   - promote referenced drafts (PROMOTE_REFERENCED)
//   - archive stale agent-authored drafts (ARCHIVE_STALE)
//   - resolve/supersede pages (RESOLVE/SUPERSEDE)
//
// Writes one digest journal entry per run; git-reversible.
// Admin-scoped over HTTP. agent_id is stamped from ctx.principal — never
// supplied by the caller.
//
// Mirrors reindexTool shape. httpMode is derived from principal.source so
// the curate() core can degrade PR verification gracefully for HTTP callers.

import { z } from "zod";
import type { ToolScope, Principal } from "../auth/types.js";
import { curate } from "../core/curate.js";

const Input = z.object({
  wiki: z.string().optional(),
  dry_run: z.boolean().optional(),
  confidence_floor: z.enum(["high", "medium", "low"]).optional(),
});

const scope: ToolScope = {
  axis: (input: any) => `wikis/${(input as any)?.wiki ?? "*"}`,
  adminOnly: () => true,
};

export const curateTool = {
  name: "vault_curate",
  description:
    "Advance page status on checkable evidence (promote landed work, promote referenced drafts, archive stale agent drafts, resolve/supersede). Writes one digest journal; git-reversible. Admin-scoped over HTTP.",
  inputSchema: Input,
  scope,
  handler: async (
    input: z.infer<typeof Input>,
    ctx: { vaultPath: string; defaultWiki?: string; principal?: Principal },
  ) => {
    const agentId = ctx.principal?.agent_id ?? "stoa-local";
    const httpMode = ctx.principal?.source === "http";
    return await curate(ctx.vaultPath, agentId, { ...input, httpMode });
  },
};
