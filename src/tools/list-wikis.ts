// vault-mcp/src/tools/list-wikis.ts
import { z } from "zod";
import { listWikis } from "../core/wikis.js";

const Input = z.object({
  include_reserved: z.boolean().default(false)
});

export const listWikisTool = {
  name: "vault.list-wikis",
  description: "List all visible wikis (always includes _agents; pass include_reserved for _archive etc.).",
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>, ctx: { vaultPath: string }) => {
    return { wikis: listWikis(ctx.vaultPath, { include_reserved: input.include_reserved }) };
  }
};
