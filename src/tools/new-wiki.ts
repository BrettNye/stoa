// vault-mcp/src/tools/new-wiki.ts
import { z } from "zod";
import { newWiki } from "../core/wikis.js";

const Input = z.object({
  name: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  mode: z.enum(["idea-map", "project-doc", "learning", "mixed"]),
  scope: z.string().min(1)
});

export const newWikiTool = {
  name: "vault.new-wiki",
  description: "Scaffold a new wiki: folders, starter map.md, log.md, CLAUDE.md, and REGISTRY entry.",
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>, ctx: { vaultPath: string }) => {
    return newWiki(ctx.vaultPath, input);
  }
};
