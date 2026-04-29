import { Command } from "commander";
import { synthesize } from "../../core/synthesize.js";
import { resolveWiki } from "../../tools/_resolve-wiki.js";
import { getCtx } from "../_ctx.js";

export function registerSynthesize(p: Command) {
  p.command("synthesize <topic>")
    .description("Compile or refresh a synthesis page")
    .option("--wiki <name>")
    .action(async (topic, opts) => {
      const ctx = getCtx();
      const wiki = resolveWiki(opts.wiki, ctx.defaultWiki, ctx.vaultPath);
      const r = await synthesize(ctx.vaultPath, { topic, wiki });
      console.log(`${r.was_overwrite ? "refreshed" : "created"}: ${r.id} (${r.inputs_used.length} inputs)`);
    });
}
