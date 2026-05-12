import { Command } from "commander";
import { startUiServer } from "../../transport/ui/index.js";
import { getCtx } from "../_ctx.js";

export function registerUi(p: Command): void {
  p.command("ui")
    .description("Run the local dashboard server")
    .option("--port <n>", "HTTP port", "4321")
    .option("--bind <addr>", "Bind address", "127.0.0.1")
    .option("--no-open", "Skip browser launch")
    .action(async (opts: { port: string; bind: string; open: boolean }) => {
      const ctx = getCtx();
      try {
        const handle = await startUiServer({
          vaultPath: ctx.vaultPath,
          port: Number(opts.port),
          bind: opts.bind,
          open: opts.open !== false,
          defaultWiki: ctx.defaultWiki,
        });
        process.stderr.write(`stoa ui → ${handle.url} (vault: ${ctx.vaultPath})\n`);
        // Wait for SIGINT for graceful shutdown
        await new Promise<void>((resolve) => {
          process.once("SIGINT", () => {
            handle.shutdown().then(() => resolve());
          });
        });
        process.exit(0);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EADDRINUSE") {
          process.stderr.write(`error: port ${opts.port} in use (try --port=...)\n`);
          process.exit(2);
        }
        process.stderr.write(`error: ${(e as Error).message}\n`);
        process.exit(1);
      }
    });
}
