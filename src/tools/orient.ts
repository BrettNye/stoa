import { z } from "zod";
import { orient } from "../core/orient-core.js";
import type { ToolScope } from "../auth/types.js";

const Input = z.object({
  vault_path: z.string(),
  recent_user_message: z.string().optional(),
});

const orientScope: ToolScope = {
  axis: (_input: any) => "vault",
};

export const orientTool = {
  name: "vault_orient",
  description:
    "Return the next-best-action for the user given current vault state. The AI calls this when uncertain how to help, or on cold session start.",
  inputSchema: Input,
  scope: orientScope,
  handler: async (raw: unknown) => {
    const parsed = Input.parse(raw);
    return orient({
      vaultPath: parsed.vault_path,
      recentUserMessage: parsed.recent_user_message,
    });
  },
};
