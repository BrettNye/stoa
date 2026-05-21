import { z } from "zod";
import { orient } from "../core/orient-core.js";

const Input = z.object({
  vault_path: z.string(),
  recent_user_message: z.string().optional(),
});

export const orientTool = {
  name: "vault_orient",
  description:
    "Return the next-best-action for the user given current vault state. The AI calls this when uncertain how to help, or on cold session start.",
  inputSchema: Input,
  handler: async (raw: unknown) => {
    const parsed = Input.parse(raw);
    return orient({
      vaultPath: parsed.vault_path,
      recentUserMessage: parsed.recent_user_message,
    });
  },
};
