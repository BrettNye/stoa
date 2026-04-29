import { Command } from "commander";
import { loadIndex, queryWikis } from "../../core/index.js";
import { getCtx } from "../_ctx.js";

export function registerListWikis(p: Command) {
  p.command("list-wikis")
    .description("List all wikis with mode, scope, page counts")
    .option("--json")
    .action(async (opts) => {
      const ctx = getCtx();
      const wikis = queryWikis(loadIndex(ctx.vaultPath));
      if (opts.json) return console.log(JSON.stringify(wikis, null, 2));
      for (const w of wikis) console.log(`  ${w.name.padEnd(20)} (${w.mode}) — ${w.scope}`);
    });
}
