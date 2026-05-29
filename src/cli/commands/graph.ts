import type { Command } from "commander";
import open from "open";
import { loadVaultStoaConfig } from "../../config.js";

export function registerGraph(program: Command): void {
  program
    .command("graph")
    .description("Open the 3D vault graph viewer in your browser")
    .action(async () => {
      try {
        const cfg = loadVaultStoaConfig(process.cwd());
        const rawBind = cfg.bind ?? "127.0.0.1:8443";
        // 0.0.0.0 is not reachable in a browser; substitute with 127.0.0.1.
        const browsableBind = rawBind.replace(/^0\.0\.0\.0(:\d+)?$/, "127.0.0.1$1");
        const url = `http://${browsableBind}/graph`;
        console.log(`Opening ${url} (run \`stoa serve\` first if the server is not running)`);
        await open(url);
      } catch (e: any) {
        process.stderr.write(`error: ${e?.message ?? e}\n`);
        process.exit(2);
      }
    });
}
