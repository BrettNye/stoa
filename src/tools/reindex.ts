// vault-mcp/src/tools/reindex.ts
import { z } from "zod";
import { reindex } from "../core/reindex.js";
import type { ToolScope } from "../auth/types.js";

const Input = z.object({ wiki: z.string().optional() });

const scope: ToolScope = {
  axis: (input: any) => (input as any).wiki ? `wikis/${(input as any).wiki}` : "*",
  adminOnly: () => true,
};

export const reindexTool = {
  name: "vault_reindex",
  description: "Regenerate _index/*.json sidecars and per-wiki index.md rollups. Map auto-sections are not regenerated (deferred indefinitely per architecture spec).",
  inputSchema: Input,
  scope,
  handler: async (input: z.infer<typeof Input>, ctx: { vaultPath: string }) => {
    return await reindex(ctx.vaultPath, input.wiki);
  }
};
