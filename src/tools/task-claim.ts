// vault-mcp/src/tools/task-claim.ts
import { z } from "zod";
import { claimTask } from "../core/tasks.js";

const Input = z.object({
  task_id: z.string(),
  agent_id: z.string(),
  expected_updated: z.string(),
  wiki: z.string().optional()
});

export const taskClaimTool = {
  name: "vault.task-claim",
  description: "Atomic claim on a pending task via mtime optimistic concurrency.",
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>, ctx: { vaultPath: string }) => {
    return claimTask(ctx.vaultPath, input);
  }
};
