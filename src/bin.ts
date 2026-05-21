#!/usr/bin/env node
import "./silence-dotenv.js"; // MUST be first — see comment in that file
import { parseConfig, ConfigError } from "./config.js";
import { setCtx } from "./cli/_ctx.js";
import { buildCli } from "./cli/index.js";
import { startStdio } from "./transport/stdio.js";

async function main() {
  // Special-case `init`: it CREATES a vault, so it must run before any
  // vault-path validation. Detect it from raw argv before parseConfig.
  // The first non-flag arg in `argv.slice(2)` is the subcommand.
  const rawArgs = process.argv.slice(2);
  const firstSubcommand = rawArgs.find(a => !a.startsWith("-"));
  const isInitSubcommand = firstSubcommand === "init";

  let config;
  if (!isInitSubcommand) {
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

  // Filter our own flags out before passing to commander
  const cliArgv = process.argv.filter(a =>
    !a.startsWith("--vault=") &&
    !a.startsWith("--default-wiki=") &&
    !a.startsWith("--default-family=") &&
    a !== "--mcp"
  );

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
