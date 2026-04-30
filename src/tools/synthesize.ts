// vault-mcp/src/tools/synthesize.ts
import { z } from "zod";
import { synthesize } from "../core/synthesize.js";
import { resolveWiki } from "./_resolve-wiki.js";

const Input = z.object({
  topic: z.string().min(1),
  wiki: z.string().optional(),
  inputs: z.array(z.string()).optional(),
  by_agent: z.string().optional(),
  scope: z.enum(["topic", "memory"]).default("topic")
});

export const synthesizeTool = {
  name: "vault.synthesize",
  description: "Compile or refresh a synthesis page from current matching pages. With by_agent + scope=memory, writes a per-agent memory synthesis at wikis/_agents/synthesis/synthesis-<by_agent>-memory.md.",
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>, ctx: { vaultPath: string; defaultWiki?: string }) => {
    const wiki = input.scope === "memory" ? "_agents" : resolveWiki(input.wiki, ctx.defaultWiki, ctx.vaultPath);
    return synthesize(ctx.vaultPath, { ...input, wiki });
  }
};
