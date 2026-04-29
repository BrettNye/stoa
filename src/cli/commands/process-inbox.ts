import { Command } from "commander";
import { listInbox, promoteInboxItem } from "../../core/inbox.js";
import { resolveWiki } from "../../tools/_resolve-wiki.js";
import { getCtx } from "../_ctx.js";

export function registerProcessInbox(p: Command) {
  p.command("process-inbox")
    .description("Walk inbox; show proposals (default) or commit with --confirm-all")
    .option("--wiki <name>")
    .option("--confirm-all", "promote all items as 'idea' (default heuristic)")
    .action(async (opts) => {
      const ctx = getCtx();
      const wiki = resolveWiki(opts.wiki, ctx.defaultWiki, ctx.vaultPath);
      const items = listInbox(ctx.vaultPath, wiki);
      if (!opts.confirmAll) {
        for (const p of items) console.log(`  ${p}  →  idea (default heuristic)`);
        console.log(`\nrun with --confirm-all to promote, or use the MCP tool for per-item type selection`);
        return;
      }
      for (const p of items) {
        const stem = p.split(/[/\\]/).pop()!.replace(/\.md$/, "").replace(/^\d{4}-\d{2}-\d{2}-\d{4}-/, "");
        const r = promoteInboxItem(ctx.vaultPath, { inbox_path: p, type: "idea", id: `idea-${stem}`, wiki });
        console.log(`promoted: ${r.from} → ${r.to}`);
      }
    });
}
