// vault-mcp/src/tools/reindex.ts
import { z } from "zod";
import { reindex } from "../core/reindex.js";

const Input = z.object({ wiki: z.string().optional() });

export const reindexTool = {
  name: "vault.reindex",
  description: "Regenerate _index/*.json, per-wiki index.md, and map auto-sections.",
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>, ctx: { vaultPath: string }) => {
    return reindex(ctx.vaultPath, input.wiki);
  }
};
