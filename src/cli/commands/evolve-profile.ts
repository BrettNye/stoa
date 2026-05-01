import { Command } from "commander";
import { readFileSync } from "node:fs";
import { evolveProfileTool } from "../../tools/evolve-profile.js";
import { getCtx } from "../_ctx.js";

export function registerEvolveProfile(p: Command) {
  p.command("evolve-profile <pokemon_id>")
    .description("Two-phase profile evolution. Default action is proposal; pass --commit with --proposal-file=<path> and --expected-updated=<iso> to apply.")
    .option("--commit", "apply the evolution (requires --proposal-file and --expected-updated)")
    .option("--proposal-file <path>", "path to a JSON file containing the proposal (typically the proposal-phase output)")
    .option("--expected-updated <iso>", "OCC token (current updated value of the profile)")
    .action(async (pokemonId: string, opts: { commit?: boolean; proposalFile?: string; expectedUpdated?: string }) => {
      const ctx = getCtx();
      if (opts.commit) {
        if (!opts.proposalFile || !opts.expectedUpdated) {
          process.stderr.write("error: --commit requires --proposal-file and --expected-updated\n");
          process.exit(2);
        }
        const proposal = JSON.parse(readFileSync(opts.proposalFile, "utf8"));
        const r = await evolveProfileTool.handler(
          { pokemon_id: pokemonId, commit: true, expected_updated: opts.expectedUpdated, proposal, cleanup_old_skills_dir: true },
          { vaultPath: ctx.vaultPath }
        );
        console.log(JSON.stringify(r, null, 2));
      } else {
        const r = await evolveProfileTool.handler(
          { pokemon_id: pokemonId, commit: false, cleanup_old_skills_dir: true },
          { vaultPath: ctx.vaultPath }
        );
        console.log(JSON.stringify(r, null, 2));
      }
    });
}
