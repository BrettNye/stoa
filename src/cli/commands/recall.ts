import { Command } from "commander";
import { recall } from "../../core/recall.js";
import { getCtx } from "../_ctx.js";

export function registerRecall(p: Command) {
  p.command("recall <topic>")
    .description("Search the vault for prior thinking on a topic")
    .option("--wiki <name>")
    .option("--layer <layer>", "knowledge|execution|all", "knowledge")
    .option("--limit <n>", "max hits", "20")
    .option("--json")
    .action(async (topic, opts) => {
      const ctx = getCtx();
      const r = await recall(ctx.vaultPath, { topic, wiki: opts.wiki, layer: opts.layer, limit: Number(opts.limit) });
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      console.log(`\n${r.hits.length} hits (total candidates: ${r.total_candidates}):\n`);
      for (const h of r.hits) console.log(`  ${h.score.toFixed(1).padStart(6)}  [${h.type}] ${h.id} — ${h.title}`);
      for (const s of r.synthesis_inline) console.log(`\n--- ${s.id} ---\n${s.body}\n`);
    });
}
