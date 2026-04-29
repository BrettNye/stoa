// vault-mcp/src/tools/lint.ts
import { z } from "zod";
import { lint } from "../core/lint.js";

const Input = z.object({
  wiki: z.string().optional(),
  level: z.enum(["error", "warning", "info"]).default("warning")
});

export const lintTool = {
  name: "vault.lint",
  description: "Read-only health check across the vault. Surfaces issues and suggestions; never mutates.",
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>, ctx: { vaultPath: string }) => {
    return lint(ctx.vaultPath, input);
  }
};
