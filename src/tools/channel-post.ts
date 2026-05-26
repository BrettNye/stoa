// vault-mcp/src/tools/channel-post.ts
import { z } from "zod";
import type { ToolScope } from "../auth/types.js";
import { postToChannel } from "../core/channel.js";
import { resolveWiki } from "./_resolve-wiki.js";

const Input = z.object({
  channel: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  content: z.string().min(1),
  wiki: z.string().optional(),
  session_id: z.string().optional()
  // agent_id REMOVED — server stamps from principal
});

const scope: ToolScope = {
  axis: (input: any) => `channels/${(input as { channel: string }).channel}`,
};

export const channelPostTool = {
  name: "vault_channel-post",
  description: "Post a message to a coordination channel. Writes a journal entry with channel field set.",
  inputSchema: Input,
  scope,
  handler: async (
    input: z.infer<typeof Input>,
    ctx: { vaultPath: string; defaultWiki?: string; principal?: { agent_id: string } },
  ) => {
    const wiki = resolveWiki(input.wiki, ctx.defaultWiki, ctx.vaultPath);
    return await postToChannel(ctx.vaultPath, {
      ...input,
      wiki,
      agent_id: ctx.principal?.agent_id ?? "stoa-local",
    });
  },
};
