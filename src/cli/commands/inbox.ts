import { Command } from "commander";
import { captureInbox } from "../../core/inbox.js";
import { resolveWiki } from "../../tools/_resolve-wiki.js";
import { getCtx } from "../_ctx.js";

export function registerInbox(p: Command) {
  p.command("inbox <thought...>")
    .description("Capture a thought to the active wiki's inbox/")
    .option("--wiki <name>")
    .action(async (thought: string[], opts) => {
      const ctx = getCtx();
      const wiki = resolveWiki(opts.wiki, ctx.defaultWiki, ctx.vaultPath);
      const r = captureInbox(ctx.vaultPath, wiki, thought.join(" "));
      console.log(`captured: ${r.id} (in ${r.wiki})`);
    });
}
