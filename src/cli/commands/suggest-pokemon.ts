import { Command } from "commander";
import { suggestPokemonTool } from "../../tools/suggest-pokemon.js";
import { getCtx } from "../_ctx.js";

export function registerSuggestPokemon(p: Command) {
  p.command("suggest-pokemon")
    .description("Suggest Pokemon names by type or dev specialty (uses PokeAPI; cached).")
    .option("--type <name>", "canonical pokemon type, e.g., fire")
    .option("--specialty <name>", "dev specialty, e.g., backend")
    .option("--stage <stage>", "evolution stage filter: basic | stage1 | stage2")
    .option("--include-existing", "include names already used by existing profiles (default: exclude)")
    .option("--limit <n>", "number of suggestions to return (default 5)", "5")
    .action(async (opts: { type?: string; specialty?: string; stage?: string; includeExisting?: boolean; limit: string }) => {
      const ctx = getCtx();
      const r = await suggestPokemonTool.handler(
        {
          pokemon_type: opts.type,
          dev_specialty: opts.specialty,
          evolution_stage: opts.stage as "basic" | "stage1" | "stage2" | undefined,
          exclude_existing: !opts.includeExisting,
          limit: parseInt(opts.limit, 10)
        },
        { vaultPath: ctx.vaultPath }
      );
      console.log(JSON.stringify(r, null, 2));
    });
}
