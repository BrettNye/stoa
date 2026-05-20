// vault-mcp/src/tools/read.ts
import { z } from "zod";
import { readPage } from "../core/pages.js";
import { resolveWiki } from "./_resolve-wiki.js";

const Input = z.object({
  id: z.string(),
  wiki: z.string().optional()
});

export const readTool = {
  name: "vault_read",
  description: "Read a page by id. Returns frontmatter, body, and updated handle for follow-up writes.",
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>, ctx: { vaultPath: string; defaultWiki?: string }) => {
    const wiki = resolveWiki(input.wiki, ctx.defaultWiki, ctx.vaultPath);
    return readPage(ctx.vaultPath, input.id, wiki);
  }
};
