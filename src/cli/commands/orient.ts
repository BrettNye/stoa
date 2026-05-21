import { Command } from "commander";
import { orient } from "../../core/orient-core.js";

export function registerOrient(program: Command): void {
  program.command("orient")
    .description("Return next-best-action given current vault state.")
    .requiredOption("--vault-path <path>", "Path to the vault root")
    .option("--message <text>", "Most recent user message (for recall-question detection)")
    .action((opts) => {
      const r = orient({ vaultPath: opts.vaultPath, recentUserMessage: opts.message });
      process.stdout.write(JSON.stringify(r, null, 2) + "\n");
    });
}
