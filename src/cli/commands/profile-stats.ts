import { Command } from "commander";
import { profileStatsTool } from "../../tools/profile-stats.js";
import { getCtx } from "../_ctx.js";

export function registerProfileStats(p: Command) {
  p.command("profile-stats <pokemon_id>")
    .description("Show stats for a profile (tasks completed/failed/in-flight, channels active, next evolution threshold)")
    .action(async (pokemonId: string) => {
      const ctx = getCtx();
      const r = await profileStatsTool.handler({ pokemon_id: pokemonId }, { vaultPath: ctx.vaultPath });
      console.log(JSON.stringify(r, null, 2));
    });
}
