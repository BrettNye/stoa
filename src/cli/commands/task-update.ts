import { Command } from "commander";
import { taskUpdateTool } from "../../tools/task-update.js";
import { resolveWiki } from "../../tools/_resolve-wiki.js";
import { getCtx } from "../_ctx.js";

export function registerTaskUpdate(p: Command) {
  p.command("task-update <task_id>")
    .description("Update a task's status, notes, or segregation. Uses mtime OCC.")
    .requiredOption("--expected-updated <iso>", "current updated timestamp from a prior read")
    .option("--wiki <name>")
    .option("--status <status>", "pending|claimed|in_progress|completed|failed|blocked")
    .option("--notes <text>")
    .option("--segregation <tags...>", "segregation tags (repeatable)")
    .option("--agent-id <id>", "attribution for the update")
    .action(async (task_id, opts) => {
      const ctx = getCtx();
      const wiki = resolveWiki(opts.wiki, ctx.defaultWiki, ctx.vaultPath);
      const r = await taskUpdateTool.handler(
        {
          task_id,
          wiki,
          expected_updated: opts.expectedUpdated,
          status: opts.status,
          notes: opts.notes,
          segregation: opts.segregation,
          agent_id: opts.agentId
        },
        { vaultPath: ctx.vaultPath }
      );
      console.log(JSON.stringify(r, null, 2));
    });
}
