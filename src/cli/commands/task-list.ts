import { Command } from "commander";
import { listTasks } from "../../core/tasks.js";
import { getCtx } from "../_ctx.js";

export function registerTaskList(p: Command) {
  p.command("task-list")
    .description("List tasks across the vault, with optional filters")
    .option("--wiki <name>")
    .option("--status <status>", "pending|claimed|in_progress|completed|failed|blocked")
    .option("--claimed-by <agent>")
    .option("--pokemon-type <type>")
    .option("--channel <name>")
    .option("--limit <n>", "max tasks", "50")
    .option("--json")
    .action(async (opts) => {
      const ctx = getCtx();
      const tasks = listTasks(ctx.vaultPath, {
        wiki: opts.wiki,
        status: opts.status,
        claimed_by: opts.claimedBy,
        pokemon_type: opts.pokemonType,
        channel: opts.channel,
        limit: Number(opts.limit)
      });
      if (opts.json) return console.log(JSON.stringify({ tasks }, null, 2));
      console.log(`\n${tasks.length} task${tasks.length === 1 ? "" : "s"}:\n`);
      for (const t of tasks) {
        const claim = t.claimed_by ? ` [${t.claimed_by}]` : "";
        const pt = t.pokemon_type ? ` <${t.pokemon_type}>` : "";
        console.log(`  ${t.status.padEnd(12)} ${t.id}${pt}${claim} — ${t.title}`);
      }
    });
}
