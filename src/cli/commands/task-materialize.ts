import { Command } from "commander";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildFollowUpPlan } from "../../core/follow-up-plan.js";
import { checkTaskReadiness } from "../../core/task-readiness.js";
import { listTasks } from "../../core/tasks.js";
import { readPage } from "../../core/pages.js";
import { getCtx } from "../_ctx.js";

export function registerTaskMaterialize(p: Command) {
  p.command("task-materialize")
    .description("Emit one follow-up plan.json per ready pending task")
    .requiredOption("--out-dir <dir>", "directory to write plan-<task-id>.json files into")
    .option("--wiki <name>")
    .option("--json")
    .action(async (opts) => {
      const ctx = getCtx();
      mkdirSync(opts.outDir, { recursive: true });
      const date = new Date().toISOString().slice(0, 10);
      const written: string[] = [];
      const skipped: { id: string; why: string }[] = [];

      for (const t of listTasks(ctx.vaultPath, { status: "pending", wiki: opts.wiki })) {
        const page = readPage(ctx.vaultPath, t.id, t.wiki);
        const readiness = checkTaskReadiness(page.body);
        if (!readiness.ready) { skipped.push({ id: t.id, why: `not ready: ${readiness.missing.join(", ")}` }); continue; }
        if (!t.segregation?.length) { skipped.push({ id: t.id, why: "no segregation paths" }); continue; }
        try {
          const plan = buildFollowUpPlan({ taskId: t.id, body: page.body, segregation: t.segregation, date });
          const out = join(opts.outDir, `plan-${t.id}.json`);
          writeFileSync(out, JSON.stringify(plan, null, 2));
          written.push(out);
        } catch (e) {
          skipped.push({ id: t.id, why: (e as Error).message });
        }
      }

      if (opts.json) return console.log(JSON.stringify({ written, skipped }, null, 2));
      console.log(`wrote ${written.length} plan(s), skipped ${skipped.length}`);
      for (const s of skipped) console.log(`  skipped ${s.id}: ${s.why}`);
    });
}
