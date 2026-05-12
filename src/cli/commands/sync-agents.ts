import { Command } from "commander";
import { syncAgentsTool } from "../../tools/sync-agents.js";
import { getCtx } from "../_ctx.js";

export function registerSyncAgents(p: Command) {
  p.command("sync-agents <target>")
    .description("Deploy a Pokemon (or all profiles) as runtime subagent definitions in <target>")
    .option("--pokemon <ids>", "comma-separated profile ids (mutually exclusive with --all)")
    .option("--all", "deploy every profile in wikis/_agents/profiles/", false)
    .option("--exclude <ids>", "comma-separated profile ids to skip (only with --all)")
    .option("--type <types>", "comma-separated pokemon_type filter (only with --all)")
    .option("--runtime <name>", "claude-code", "claude-code")
    .option("--mode <mode>", "copy | symlink", "copy")
    .option("--no-overwrite", "skip files that already exist")
    .option("--no-include-moveset", "do not sync each profile's moveset")
    .option("--continue-on-error", "best-effort: keep going past failed profiles (default true when --all)", undefined)
    .action(async (target: string, opts: any) => {
      const ctx = getCtx();

      if (opts.pokemon && opts.all) {
        console.error("error: --pokemon and --all are mutually exclusive");
        process.exit(2);
      }
      if (!opts.pokemon && !opts.all) {
        console.error("error: one of --pokemon or --all is required");
        process.exit(2);
      }

      const continueOnError = opts.continueOnError ?? Boolean(opts.all);

      const input: any = opts.all
        ? {
            all: true,
            target,
            runtime: opts.runtime,
            mode: opts.mode,
            overwrite: opts.overwrite,
            include_moveset: opts.includeMoveset,
            exclude: opts.exclude ? opts.exclude.split(",").map((s: string) => s.trim()) : [],
            pokemon_type: opts.type ? opts.type.split(",").map((s: string) => s.trim()) : [],
            continue_on_error: continueOnError,
          }
        : {
            pokemon: opts.pokemon.includes(",")
              ? opts.pokemon.split(",").map((s: string) => s.trim())
              : opts.pokemon,
            target,
            runtime: opts.runtime,
            mode: opts.mode,
            overwrite: opts.overwrite,
            include_moveset: opts.includeMoveset,
            continue_on_error: continueOnError,
          };

      const result = await syncAgentsTool.handler(input, { vaultPath: ctx.vaultPath });
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.summary.failed > 0 ? 1 : 0);
    });
}
