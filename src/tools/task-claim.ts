// vault-mcp/src/tools/task-claim.ts
import { z } from "zod";
import { claimTask, TaskNotReadyError } from "../core/tasks.js";
import { resolveWiki } from "./_resolve-wiki.js";

const Input = z.object({
  task_id: z.string(),
  agent_id: z.string(),
  expected_updated: z.string(),
  wiki: z.string().optional(),
  force: z.boolean().optional(),
});

export const taskClaimTool = {
  name: "vault.task-claim",
  description: "Atomic claim on a pending task. Refuses claims on ungroomed tasks (missing files/scope/out_of_scope/verification body signals) unless force: true. Mtime-OCC concurrency control. If the task has required_pokemon_type, the claimant's profile must match.",
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>, ctx: { vaultPath: string; defaultWiki?: string }) => {
    const wiki = resolveWiki(input.wiki, ctx.defaultWiki, ctx.vaultPath);
    try {
      return claimTask(ctx.vaultPath, { ...input, wiki });
    } catch (e) {
      if (e instanceof TaskNotReadyError) {
        throw Object.assign(new Error(e.message), {
          code: "TASK_NOT_READY",
          missing: e.missing,
          task_id: e.taskId,
        });
      }
      throw e;
    }
  },
};
