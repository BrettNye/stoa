import { z } from "zod";
import { syncMoveset } from "../core/skills.js";

const Input = z.object({
  repo_path: z.string(),
  pokemon: z.string(),
  target: z.enum(["claude-code", "openclaw", "codex"]).default("claude-code"),
  mode: z.enum(["copy", "symlink"]).default("symlink")
});

export const syncSkillsTool = {
  name: "vault.sync-skills",
  description: "Deploy a Pokemon's moveset into a target repo's local skills directory.",
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>, ctx: { vaultPath: string }) => {
    const result = syncMoveset({
      vaultPath: ctx.vaultPath,
      repoPath: input.repo_path,
      pokemon_id: input.pokemon,
      target: input.target,
      mode: input.mode
    });
    return {
      skills_dir: result.skills_dir,
      moves_synced: result.moves_synced,
      moves_skipped_unsupported: result.moves_skipped_unsupported
    };
  }
};
