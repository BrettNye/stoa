import type { Command } from "commander";
import open from "open";
import { loadVaultStoaConfig } from "../../config.js";

export function registerGraph(program: Command): void {
  program
    .command("graph")
    .description("Open the 3D vault graph viewer in your browser")
    .action(async () => {
      const cfg = loadVaultStoaConfig(process.cwd());
      const url = `http://${cfg.bind ?? "127.0.0.1:8443"}/graph`;
      console.log(`Opening ${url} (run \`stoa serve\` first if the server is not running)`);
      await open(url);
    });
}
