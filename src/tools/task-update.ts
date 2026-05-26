import { z } from "zod";
import type { ToolScope } from "../auth/types.js";
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
  // agent_id REMOVED — server stamps from principal
});

const scope: ToolScope = {
  axis: (input: any) => `tasks/${(input as { task_id: string }).task_id}`,
};

export const taskUpdateTool = {
  name: "vault_task-update",
  description: "Update a task's status, notes, or segregation. Uses mtime OCC.",
  inputSchema: Input,
  scope,
  handler: async (
    input: z.infer<typeof Input>,
    ctx: { vaultPath: string; principal?: { agent_id: string } },
  ) => {
    const agent_id = ctx.principal?.agent_id ?? "stoa-local";
    const result = updateTask(ctx.vaultPath, { ...input, agent_id });
    // v1.7 §5.1 — write-through index update so the changed task fields
    // (status, segregation, updated) are immediately visible to loadIndex-based
    // tools (recall, merge-queue, start) without requiring a manual reindex.
    const path = pathForPage(ctx.vaultPath, input.task_id, "task", input.wiki);
    await upsertPage(ctx.vaultPath, path);
    return result;
  },
};
