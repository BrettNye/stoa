import { z } from "zod";
import { updateTask } from "../core/tasks.js";
import { pathForPage } from "../core/pages.js";
import { upsertPage } from "../core/index.js";

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
    const result = updateTask(ctx.vaultPath, input);
    // v1.7 §5.1 — write-through index update so the changed task fields
    // (status, segregation, updated) are immediately visible to loadIndex-based
    // tools (recall, merge-queue, start) without requiring a manual reindex.
    const path = pathForPage(ctx.vaultPath, input.task_id, "task", input.wiki);
    await upsertPage(ctx.vaultPath, path);
    return result;
  }
};
