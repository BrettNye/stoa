import { Command } from "commander";
import { claimTask } from "../../core/tasks.js";
import { readPage } from "../../core/pages.js";
import { resolveWiki } from "../../tools/_resolve-wiki.js";
import { getCtx } from "../_ctx.js";

export function registerClaimTask(p: Command) {
  p.command("claim-task <task_id>")
    .description("Atomically claim a task")
    .requiredOption("--as <agent_id>")
    .option("--wiki <name>")
    .action(async (task_id, opts) => {
      const ctx = getCtx();
      const wiki = resolveWiki(opts.wiki, ctx.defaultWiki, ctx.vaultPath);
      const page = readPage(ctx.vaultPath, task_id, wiki);
      const r = await claimTask(ctx.vaultPath, { task_id, agent_id: opts.as, expected_updated: page.updated, wiki });
      console.log(`claimed: ${r.task_id} by ${r.claimed_by} at ${r.claimed_at}`);
    });
}
