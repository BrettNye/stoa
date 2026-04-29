// vault-mcp/src/tools/recall.ts
import { z } from "zod";
import { recall } from "../core/recall.js";

const Input = z.object({
  topic: z.string().min(1),
  wiki: z.string().optional(),
  layer: z.enum(["knowledge", "execution", "all"]).default("knowledge"),
  include_archive: z.boolean().default(false),
  limit: z.number().int().positive().default(20)
});

export const recallTool = {
  name: "vault.recall",
  description: "Search the vault for prior thinking on a topic. Returns ranked hits with synthesis content inline.",
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>, ctx: { vaultPath: string }) => {
    return recall(ctx.vaultPath, input);
  }
};
