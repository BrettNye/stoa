import type { Command } from "commander";
import { startTool } from "../../tools/start.js";
import { getCtx } from "../_ctx.js";

export function registerStart(program: Command): void {
  program
    .command("start")
    .description("Cold-session ritual: read map, tail channels, run recall, return context brief")
    .option("--wiki <name>", "wiki to bootstrap into")
    .option("--pokemon <id>", "profile id; if set, includes pokemon_state and tails its declared channels")
    .option("--since <iso>", "lookback cutoff for channel activity (defaults to 24h ago)")
    .action(async (opts: { wiki?: string; pokemon?: string; since?: string }) => {
      const ctx = getCtx();
      const result = await startTool.handler(
        { wiki: opts.wiki, pokemon: opts.pokemon, since: opts.since },
        { vaultPath: ctx.vaultPath, defaultWiki: ctx.defaultWiki }
      );
      console.log(JSON.stringify(result, null, 2));
    });
}
