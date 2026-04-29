import type { Command } from "commander";
import { bootstrapRepoTool } from "../../tools/bootstrap-repo.js";
import { getCtx } from "../_ctx.js";

export function registerBootstrapRepo(program: Command): void {
  program
    .command("bootstrap-repo <repo_path>")
    .description("Wire a repo to the vault MCP: writes .mcp.json + CLAUDE.md fragment + (optionally) deploys a Pokemon's moveset")
    .requiredOption("--wiki <wiki>", "wiki this repo's work belongs to")
    .option("--pokemon <id>", "profile id; if set, deploy moveset")
    .option("--channels <list>", "comma-separated channel names to tail")
    .action(async (repoPath: string, opts: { wiki: string; pokemon?: string; channels?: string }) => {
      const ctx = getCtx();
      const channels = opts.channels ? opts.channels.split(",") : undefined;
      const result = await bootstrapRepoTool.handler(
        { repo_path: repoPath, wiki: opts.wiki, pokemon: opts.pokemon, channels },
        { vaultPath: ctx.vaultPath }
      );
      console.log(JSON.stringify(result, null, 2));
    });
}
