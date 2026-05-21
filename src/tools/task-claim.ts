// vault-mcp/src/tools/task-claim.ts
import { z } from "zod";
import type { ToolScope } from "../auth/types.js";
import { claimTask, TaskNotReadyError } from "../core/tasks.js";
import { resolveWiki } from "./_resolve-wiki.js";

const Input = z.object({
  task_id: z.string(),
  // agent_id REMOVED — server stamps from principal
  expected_updated: z.string(),
  wiki: z.string().optional(),
  force: z.boolean().optional(),
});

const scope: ToolScope = {
  axis: (input: any) => `tasks/${(input as { task_id: string }).task_id}`,
};

export const taskClaimTool = {
  name: "vault_task-claim",
  description:
    "Atomic claim on a pending task. Refuses claims on ungroomed tasks (missing files/scope/out_of_scope/verification body signals) unless force: true. Mtime-OCC concurrency control. If the task has required_pokemon_type, the claimant's profile must match.",
  inputSchema: Input,
  scope,
  handler: async (
    input: z.infer<typeof Input>,
    ctx: { vaultPath: string; defaultWiki?: string; principal?: { agent_id: string } },
  ) => {
    const wiki = resolveWiki(input.wiki, ctx.defaultWiki, ctx.vaultPath);
    const agent_id = ctx.principal?.agent_id ?? "stoa-local";
    try {
      return claimTask(ctx.vaultPath, { ...input, wiki, agent_id });
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
