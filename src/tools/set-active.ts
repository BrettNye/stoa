// vault-mcp/src/tools/set-active.ts
import { z } from "zod";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ToolScope } from "../auth/types.js";

const Input = z.object({ wiki: z.string() });

const scope: ToolScope = {
  axis: () => "vault",
  adminOnly: () => true,
};

export const setActiveTool = {
  name: "vault_set-active",
  description: "Set the .active-wiki pointer at vault root.",
  inputSchema: Input,
  scope,
  handler: async (input: z.infer<typeof Input>, ctx: { vaultPath: string }) => {
    const wikiDir = join(ctx.vaultPath, "wikis", input.wiki);
    if (!existsSync(wikiDir)) throw new Error(`wiki does not exist: ${input.wiki}`);
    writeFileSync(join(ctx.vaultPath, ".active-wiki"), input.wiki + "\n");
    return { active_wiki: input.wiki };
  }
};
