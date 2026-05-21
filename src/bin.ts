#!/usr/bin/env node
import "./silence-dotenv.js"; // MUST be first — see comment in that file
import { parseConfig, ConfigError } from "./config.js";
import { setCtx } from "./cli/_ctx.js";
import { buildCli } from "./cli/index.js";
import { startStdio } from "./transport/stdio.js";

async function main() {
  // Subcommands that handle their own vault-path resolution (or don't need one)
  // must bypass parseConfig's required-vault check. They resolve --vault /
  // STOA_VAULT_PATH inside their own action handler — letting parseConfig run
  // first would fail before they ever execute.
  //
  // - `init` creates a vault, so it precedes vault validation.
  // - `serve` resolves vault path inside its action (supports --vault + STOA_VAULT_PATH).
  // - `mint-token` only needs STOA_TOKEN_SIGNING_SECRET; no vault required.
  const rawArgs = process.argv.slice(2);
  const firstSubcommand = rawArgs.find(a => !a.startsWith("-"));
  const SELF_CONFIGURING_SUBCOMMANDS = new Set(["init", "serve", "mint-token"]);
  const isSelfConfiguring = firstSubcommand !== undefined && SELF_CONFIGURING_SUBCOMMANDS.has(firstSubcommand);

  let config;
  if (!isSelfConfiguring) {
    try {
      config = parseConfig(rawArgs);
    } catch (e) {
      if (e instanceof ConfigError) {
        process.stderr.write(`error: ${e.message}\n`);
        process.exit(2);
      }
      throw e;
    }
  }

  // Filter our own flags out before passing to commander — but only when we
  // actually consumed them via parseConfig. Self-configuring subcommands
  // need to see --vault themselves so their commander option can pick it up.
  const cliArgv = process.argv.filter(a => {
    if (a === "--mcp") return false; // never a commander flag
    if (a.startsWith("--default-wiki=") || a.startsWith("--default-family=")) return false;
    if (a.startsWith("--vault=")) return !isSelfConfiguring; // pass through to self-configuring subcommands
    return true;
  });

  if (config?.mcpMode) {
    await startStdio(config);
    return; // server runs until stdin closes
  }

  if (config) setCtx(config);
  const program = buildCli();
  await program.parseAsync(cliArgv);
}

main().catch(err => {
  process.stderr.write(`error: ${err?.message ?? err}\n`);
  process.exit(1);
});
