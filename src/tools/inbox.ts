// vault-mcp/src/tools/inbox.ts
import { z } from "zod";
import { captureInbox } from "../core/inbox.js";
import { resolveWiki } from "./_resolve-wiki.js";
import type { ToolScope } from "../auth/types.js";

const Input = z.object({
  thought: z.string().min(1),
  wiki: z.string().optional()
});

const scope: ToolScope = {
  axis: (i: any) => `wikis/${i.wiki ?? "*"}/inbox`,
};

export const inboxTool = {
  name: "vault_inbox",
  description: "Drop a fleeting thought into the active wiki's inbox/. Datestamped filename, no frontmatter required.",
  inputSchema: Input,
  scope,
  handler: async (input: z.infer<typeof Input>, ctx: { vaultPath: string; defaultWiki?: string }) => {
    const wiki = resolveWiki(input.wiki, ctx.defaultWiki, ctx.vaultPath);
    return captureInbox(ctx.vaultPath, wiki, input.thought);
  }
};
