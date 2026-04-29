import type { Command } from "commander";
import { startTool } from "../../tools/start.js";
import { getCtx } from "../_ctx.js";

export function registerStart(program: Command): void {
  program
    .command("start")
    .description("Cold-session ritual: read map, tail channels, run recall, return context brief")
    .option("--wiki <name>", "wiki to bootstrap into")
    .option("--pokemon <id>", "profile id; if set, includes pokemon_state in brief")
    .action(async (opts: { wiki?: string; pokemon?: string }) => {
      const ctx = getCtx();
      const result = await startTool.handler(
        { wiki: opts.wiki, pokemon: opts.pokemon },
        { vaultPath: ctx.vaultPath }
      );
      console.log(JSON.stringify(result, null, 2));
    });
}
