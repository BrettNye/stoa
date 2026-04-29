import { z } from "zod";
import { updateTask } from "../core/tasks.js";

const Input = z.object({
  task_id: z.string(),
  wiki: z.string(),
  expected_updated: z.string(),
  status: z.enum(["pending", "claimed", "in_progress", "completed", "failed", "blocked"]).optional(),
  notes: z.string().optional(),
  segregation: z.array(z.string()).optional(),
  agent_id: z.string().optional()
});

export const taskUpdateTool = {
  name: "vault.task-update",
  description: "Update a task's status, notes, or segregation. Uses mtime OCC.",
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>, ctx: { vaultPath: string }) => {
    return updateTask(ctx.vaultPath, input);
  }
};
