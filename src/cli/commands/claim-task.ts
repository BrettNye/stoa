import { Command } from "commander";
import { claimTask, TaskNotReadyError } from "../../core/tasks.js";
import { readPage } from "../../core/pages.js";
import { resolveWiki } from "../../tools/_resolve-wiki.js";
import { getCtx } from "../_ctx.js";

export function registerClaimTask(p: Command) {
  p.command("claim-task <task_id>")
    .description("Atomically claim a task. Refuses ungroomed tasks unless --force.")
    .requiredOption("--as <agent_id>")
    .option("--wiki <name>")
    .option("--force", "bypass readiness check (use when claiming a known-ungroomed task by hand)")
    .action(async (task_id, opts) => {
      const ctx = getCtx();
      const wiki = resolveWiki(opts.wiki, ctx.defaultWiki, ctx.vaultPath);
      const page = readPage(ctx.vaultPath, task_id, wiki);
      try {
        const r = await claimTask(ctx.vaultPath, {
          task_id,
          agent_id: opts.as,
          expected_updated: page.updated,
          wiki,
          force: Boolean(opts.force),
        });
        console.log(`claimed: ${r.task_id} by ${r.claimed_by} at ${r.claimed_at}`);
      } catch (e) {
        if (e instanceof TaskNotReadyError) {
          console.error(`✗ ${e.message}`);
          console.error(`  Missing: ${e.missing.join(", ")}`);
          console.error(`  Add the missing sections to the task body, or re-run with --force.`);
          process.exitCode = 2;
          return;
        }
        throw e;
      }
    });
}
