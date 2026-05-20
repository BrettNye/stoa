import type { Command } from "commander";
import { seedSubstrateTool } from "../../tools/seed-substrate.js";
import { getCtx } from "../_ctx.js";

export function registerSeedSubstrate(program: Command): void {
  program
    .command("seed-substrate")
    .description("Copy stoa's bundled seed substrate (example profiles, moves, and onboarding course) into <vault>/wikis/_agents/")
    .option("--vault-path <path>", "vault root path; defaults to the resolved CLI vault")
    .option("--force", "overwrite existing files", false)
    .action(async (opts: { vaultPath?: string; force: boolean }) => {
      const ctx = getCtx();
      const result = await seedSubstrateTool.handler(
        { vault_path: opts.vaultPath, force: opts.force },
        { vaultPath: ctx.vaultPath }
      );
      console.log(JSON.stringify(result, null, 2));
    });
}
