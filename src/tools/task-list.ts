import { z } from "zod";
import { listTasks } from "../core/tasks.js";

const Input = z.object({
  wiki: z.string().optional(),
  status: z.enum(["pending", "claimed", "in_progress", "completed", "failed", "blocked"]).optional(),
  claimed_by: z.string().optional(),
  channel: z.string().optional(),
  pokemon_type: z.string().optional(),
  limit: z.number().int().positive().default(50)
});

export const taskListTool = {
  name: "vault.task-list",
  description: "List tasks across the vault, with optional filters.",
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>, ctx: { vaultPath: string }) => {
    return { tasks: listTasks(ctx.vaultPath, input) };
  }
};
