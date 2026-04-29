#!/usr/bin/env node
import { parseConfig, ConfigError } from "./config.js";
import { setCtx } from "./cli/_ctx.js";
import { buildCli } from "./cli/index.js";
import { startStdio } from "./transport/stdio.js";

async function main() {
  let config;
  try {
    config = parseConfig(process.argv.slice(2));
  } catch (e) {
    if (e instanceof ConfigError) {
      process.stderr.write(`error: ${e.message}\n`);
      process.exit(2);
    }
    throw e;
  }

  // Filter our own flags out before passing to commander
  const cliArgv = process.argv.filter(a =>
    !a.startsWith("--vault=") &&
    !a.startsWith("--default-wiki=") &&
    a !== "--mcp"
  );

  if (config.mcpMode) {
    await startStdio(config);
    return; // server runs until stdin closes
  }

  setCtx(config);
  const program = buildCli();
  await program.parseAsync(cliArgv);
}

main().catch(err => {
  process.stderr.write(`error: ${err?.message ?? err}\n`);
  process.exit(1);
});
