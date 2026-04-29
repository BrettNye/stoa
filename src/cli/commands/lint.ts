import { Command } from "commander";
import { lint } from "../../core/lint.js";
import { getCtx } from "../_ctx.js";

export function registerLint(p: Command) {
  p.command("lint")
    .description("Read-only health check across the vault")
    .option("--wiki <name>")
    .option("--json")
    .action(async (opts) => {
      const ctx = getCtx();
      const r = await lint(ctx.vaultPath, { wiki: opts.wiki });
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      console.log(`\n${r.summary.errors} errors, ${r.summary.warnings} warnings, ${r.summary.info} info:\n`);
      for (const d of r.diagnostics) {
        const tag = d.severity.toUpperCase().padEnd(8);
        console.log(`  ${tag} [${d.code}] ${d.page_id ?? d.wiki ?? ""} — ${d.message}`);
        if (d.suggestion) console.log(`           → ${d.suggestion}`);
      }
      process.exit(r.summary.errors > 0 ? 1 : 0);
    });
}
