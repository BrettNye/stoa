// vault-mcp/src/tools/channel-tail.ts
import { z } from "zod";
import { tailChannel } from "../core/channel.js";

const Input = z.object({
  channel: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  since: z.string().optional(),
  limit: z.number().int().positive().default(50),
  wiki: z.string().optional()
});

export const channelTailTool = {
  name: "vault_channel-tail",
  description: "Pull recent journal/task entries on a channel since a timestamp.",
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>, ctx: { vaultPath: string }) => {
    return tailChannel(ctx.vaultPath, input);
  }
};
