import { Command } from "commander";
import { syncSkillsTool } from "../../tools/sync-skills.js";
import { getCtx } from "../_ctx.js";

export function registerSyncSkills(p: Command) {
  p.command("sync-skills <repo_path>")
    .description("Deploy a Pokemon's moveset into a target repo's local skills directory")
    .requiredOption("--pokemon <id>", "profile id whose moveset to deploy")
    .option("--target <runtime>", "claude-code | openclaw | codex", "claude-code")
    .option("--mode <mode>", "copy | symlink", "symlink")
    .action(async (repoPath: string, opts: { pokemon: string; target: string; mode: string }) => {
      const ctx = getCtx();
      const result = await syncSkillsTool.handler(
        {
          repo_path: repoPath,
          pokemon: opts.pokemon,
          target: opts.target as "claude-code" | "openclaw" | "codex",
          mode: opts.mode as "copy" | "symlink"
        },
        { vaultPath: ctx.vaultPath }
      );
      console.log(JSON.stringify(result, null, 2));
    });
}
