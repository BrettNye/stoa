import { z } from "zod";
import type { ToolScope } from "../auth/types.js";
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
  estimate_minutes: z.number().int().nonnegative().optional(),
  // agent_id not applicable here — createTask doesn't take agent_id
});

const scope: ToolScope = {
  axis: (input: any) => `wikis/${(input as { wiki: string }).wiki}`,
};

export const taskCreateTool = {
  name: "vault_task-create",
  description: "Create a new task in a wiki's task queue. Status starts as pending.",
  inputSchema: Input,
  scope,
  handler: async (
    input: z.infer<typeof Input>,
    ctx: { vaultPath: string },
  ) => {
    const result = createTask(ctx.vaultPath, input);
    // v1.7 §5.1 — write-through index update so the new task is immediately
    // visible to loadIndex-based tools (recall, merge-queue, start) without
    // requiring a manual reindex.
    await upsertPage(ctx.vaultPath, result.path);
    return result;
  },
};
