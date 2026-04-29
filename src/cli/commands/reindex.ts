import { Command } from "commander";
import { reindex } from "../../core/reindex.js";
import { getCtx } from "../_ctx.js";

export function registerReindex(p: Command) {
  p.command("reindex")
    .description("Regenerate _index/*.json + per-wiki index.md + map auto-sections")
    .option("--wiki <name>", "limit to one wiki")
    .action(async (opts) => {
      const ctx = getCtx();
      const r = reindex(ctx.vaultPath, opts.wiki);
      console.log(`reindexed: ${r.pages_indexed} pages, ${r.wikis_indexed} wikis, ${r.links_indexed} links (${r.duration_ms}ms)`);
    });
}
