import { Command } from "commander";
import { syncSkillsTool } from "../../tools/sync-skills.js";
import { getCtx } from "../_ctx.js";

export function registerSyncSkills(p: Command) {
  p.command("sync-skills <repo_path>")
    .description("Deploy a Pokemon's moveset (or all profiles' movesets) into a target repo's local skills directory")
    .option("--pokemon <id>", "profile id whose moveset to deploy (mutually exclusive with --all)")
    .option("--all", "deploy moveset for every profile in wikis/_agents/profiles/", false)
    .option("--exclude <ids>", "comma-separated profile ids to skip (only with --all)")
    .option("--type <types>", "comma-separated pokemon_type filter (only with --all)")
    .option("--target <runtime>", "claude-code | openclaw | codex", "claude-code")
    .option("--mode <mode>", "copy | symlink", "symlink")
    .option("--reverify", "scan deployed SKILL.md for drift instead of deploying", false)
    .option("--fix", "with --reverify, re-deploy drifted moves", false)
    .option("--continue-on-error", "best-effort: keep going past failed profiles (default true when --all)", undefined)
    .action(async (repoPath: string, opts: any) => {
      const ctx = getCtx();

      if (opts.pokemon && opts.all) {
        console.error("error: --pokemon and --all are mutually exclusive");
        process.exit(2);
      }
      if (!opts.reverify && !opts.pokemon && !opts.all) {
        console.error("error: deploy mode requires --pokemon or --all");
        process.exit(2);
      }

      const continueOnError = opts.continueOnError ?? Boolean(opts.all);

      const result = await syncSkillsTool.handler(
        {
          repo_path: repoPath,
          pokemon: opts.pokemon,
          all: Boolean(opts.all),
          exclude: opts.exclude ? opts.exclude.split(",").map((s: string) => s.trim()) : [],
          pokemon_type: opts.type ? opts.type.split(",").map((s: string) => s.trim()) : [],
          target: opts.target as "claude-code" | "openclaw" | "codex",
          mode: opts.mode as "copy" | "symlink",
          reverify: Boolean(opts.reverify),
          fix: Boolean(opts.fix),
          continue_on_error: continueOnError,
        } as any,
        { vaultPath: ctx.vaultPath }
      );
      console.log(JSON.stringify(result, null, 2));
      // For all-mode, exit non-zero on any failure; for single-mode the old
      // shape doesn't carry a summary, so exit 0 unless an error was thrown.
      if (opts.all && result && (result as any).summary?.failed > 0) {
        process.exit(1);
      }
    });
}
