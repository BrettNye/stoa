// src/tools/channel.ts
import { z } from "zod";
import type { ToolScope } from "../auth/types.js";
import { postToChannel } from "../core/channel.js";
import { tailChannel } from "../core/channel.js";
import { resolveWiki } from "./_resolve-wiki.js";
import { requireField } from "./_mode.js";

const Input = z.object({
  mode: z.enum(["post", "tail"]),
  channel: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  content: z.string().min(1).optional(),  // post
  session_id: z.string().optional(),      // post
  since: z.string().optional(),           // tail
  limit: z.number().int().positive().default(50), // tail
  wiki: z.string().optional(),
});

type Input = z.infer<typeof Input>;

const scope: ToolScope = {
  axis: (input: any) => `channels/${input?.channel ?? "*"}`,
};

export const channelTool = {
  name: "vault_channel",
  description:
    "Coordination channel. mode: post (write a channel journal entry) | tail (read recent entries since a cursor).",
  inputSchema: Input,
  scope,
  handler: async (
    input: Input,
    ctx: {
      vaultPath: string;
      defaultWiki?: string;
      principal?: { agent_id: string };
    },
  ) => {
    if (input.mode === "post") {
      const content = requireField(input.content, "vault_channel mode=post", "content");
      const wiki = resolveWiki(input.wiki, ctx.defaultWiki, ctx.vaultPath);
      return postToChannel(ctx.vaultPath, {
        ...input,
        content,
        wiki,
        agent_id: ctx.principal?.agent_id ?? "stoa-local",
      });
    }
    return tailChannel(ctx.vaultPath, input);
  },
};
