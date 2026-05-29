import { Command } from "commander";
import { getCtx } from "../_ctx.js";
import { curate } from "../../core/curate.js";
import { makeDefaultRunner } from "../../core/curate-git.js";

export function registerCurate(p: Command) {
  p.command("curate")
    .description("Auto-advance page status on checkable evidence")
    .option("--wiki <name>", "limit to one wiki")
    .option("--dry-run", "preview changes without writing")
    .option("--confidence-floor <level>", "minimum confidence level (high|medium|low)")
    .action(async (opts) => {
      const ctx = getCtx();
      const run = makeDefaultRunner();
      const r = await curate(
        ctx.vaultPath,
        "stoa-cli",
        {
          wiki: opts.wiki,
          dry_run: opts.dryRun,
          confidence_floor: opts.confidenceFloor,
        },
        run,
      );
      console.log(
        `applied ${r.applied.length}, flagged ${r.flagged.length}${r.journal_id ? ` — ${r.journal_id}` : ""}`,
      );
    });
}
