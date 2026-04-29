// vault-mcp/src/tools/synthesize.ts
import { z } from "zod";
import { synthesize } from "../core/synthesize.js";
import { resolveWiki } from "./_resolve-wiki.js";

const Input = z.object({
  topic: z.string().min(1),
  wiki: z.string().optional(),
  inputs: z.array(z.string()).optional()
});

export const synthesizeTool = {
  name: "vault.synthesize",
  description: "Compile or refresh a synthesis page from current matching pages. Idempotent.",
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>, ctx: { vaultPath: string; defaultWiki?: string }) => {
    const wiki = resolveWiki(input.wiki, ctx.defaultWiki, ctx.vaultPath);
    return synthesize(ctx.vaultPath, { ...input, wiki });
  }
};
