// vault-mcp/src/tools/list-wikis.ts
import { z } from "zod";
import { loadIndex, queryWikis } from "../core/index.js";

const Input = z.object({});

export const listWikisTool = {
  name: "vault.list-wikis",
  description: "List all wikis in the vault with their mode, scope, page counts, and last-touched timestamp.",
  inputSchema: Input,
  handler: async (_input: z.infer<typeof Input>, ctx: { vaultPath: string }) => {
    const idx = loadIndex(ctx.vaultPath);
    return { wikis: queryWikis(idx) };
  }
};
