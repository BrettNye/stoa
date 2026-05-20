import { Command } from "commander";
import { newProfileTool } from "../../tools/new-profile.js";
import { getCtx } from "../_ctx.js";

export function registerNewProfile(p: Command) {
  p.command("new-profile <title>")
    .description("Scaffold a new agent profile with v1.5 substrate frontmatter pre-filled.")
    .option("--wiki <name>", "wiki to scaffold under (defaults to active wiki)")
    .option("--pokemon <name>", "explicit Pokemon name (skips the roll)")
    .option("--pokemon-type <name>", "canonical pokemon type, e.g., fire")
    .option("--dev-specialty <name>", "dev specialty, e.g., backend (mapped to a type)")
    .option("--evolution-stage <stage>", "basic | stage1 | stage2 (default: basic)")
    .option("--autonomy-level <level>", "restricted | feature-branch | main-branch (default: restricted)")
    .option("--moveset <ids...>", "space-separated move ids to seed the moveset with")
    .option("--applies-to <runtimes...>", "runtimes this profile deploys into (default: claude-code)")
    .action(async (title: string, opts: {
      wiki?: string;
      pokemon?: string;
      pokemonType?: string;
      devSpecialty?: string;
      evolutionStage?: string;
      autonomyLevel?: string;
      moveset?: string[];
      appliesTo?: string[];
    }) => {
      const ctx = getCtx();
      const r = await newProfileTool.handler(
        {
          title,
          wiki: opts.wiki,
          pokemon: opts.pokemon,
          pokemon_type: opts.pokemonType,
          dev_specialty: opts.devSpecialty,
          evolution_stage: opts.evolutionStage as "basic" | "stage1" | "stage2" | undefined,
          autonomy_level: opts.autonomyLevel as "restricted" | "feature-branch" | "main-branch" | undefined,
          moveset: opts.moveset,
          applies_to: opts.appliesTo
        },
        { vaultPath: ctx.vaultPath, defaultWiki: ctx.defaultWiki }
      );
      console.log(`created: ${r.id} at ${r.path}`);
      console.log(`pokemon: ${r.pokemon} (${r.profile_summary.pokemon_type}, ${r.profile_summary.evolution_stage})`);
    });
}
