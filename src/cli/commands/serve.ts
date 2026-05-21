import { Command } from "commander";
import { startHttp } from "../../transport/http.js";

export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Start Stoa as an HTTP MCP server")
    .option("--bind <host_port>", "host:port to bind (overrides .stoa/config.json)")
    .option("--vault <path>", "vault root path (overrides STOA_VAULT_PATH)")
    .action(async (opts) => {
      const vaultPath = opts.vault ?? process.env.STOA_VAULT_PATH;
      if (!vaultPath) {
        process.stderr.write("error: --vault or STOA_VAULT_PATH required\n");
        process.exit(2);
        return;
      }
      try {
        await startHttp({ vaultPath, mcpMode: false }, opts.bind ? { bindOverride: opts.bind } : {});
      } catch (e: any) {
        process.stderr.write(`error: ${e?.message ?? e}\n`);
        process.exit(2);
      }
    });
}
