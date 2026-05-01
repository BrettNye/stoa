import { z } from "zod";
import { createTask } from "../core/tasks.js";
import { upsertPage } from "../core/index.js";

const Input = z.object({
  title: z.string().min(1),
  wiki: z.string(),
  description: z.string().optional(),
  segregation: z.array(z.string()).optional(),
  blocking: z.array(z.string()).optional(),
  channel: z.string().optional(),
  required_pokemon_type: z.string().optional(),
  estimate_minutes: z.number().int().nonnegative().optional()
});

export const taskCreateTool = {
  name: "vault.task-create",
  description: "Create a new task in a wiki's task queue. Status starts as pending.",
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>, ctx: { vaultPath: string }) => {
    const result = createTask(ctx.vaultPath, input);
    // v1.7 §5.1 — write-through index update so the new task is immediately
    // visible to loadIndex-based tools (recall, merge-queue, start) without
    // requiring a manual reindex.
    await upsertPage(ctx.vaultPath, result.path);
    return result;
  }
};
