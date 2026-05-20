// vault-mcp/src/tools/new-wiki.ts
import { z } from "zod";
import { newWiki } from "../core/wikis.js";

const Input = z.object({
  name: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  mode: z.enum(["idea-map", "project-doc", "learning", "mixed"]),
  scope: z.string().min(1),
  // Phase-2 T3-1 — optional family group; when set, the scaffolded
  // CLAUDE.md declares `**Family:** <name>` for reindex to surface.
  family: z.string().optional()
});

export const newWikiTool = {
  name: "vault_new-wiki",
  description: "Scaffold a new wiki: folders, starter map.md, log.md, CLAUDE.md, and REGISTRY entry.",
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>, ctx: { vaultPath: string }) => {
    return newWiki(ctx.vaultPath, input);
  }
};
