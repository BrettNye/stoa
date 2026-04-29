import { Command } from "commander";
import { readPage } from "../../core/pages.js";
import { resolveWiki } from "../../tools/_resolve-wiki.js";
import { getCtx } from "../_ctx.js";

export function registerRead(p: Command) {
  p.command("read <id>")
    .description("Read a page by id")
    .option("--wiki <name>")
    .option("--json")
    .action(async (id, opts) => {
      const ctx = getCtx();
      const wiki = resolveWiki(opts.wiki, ctx.defaultWiki, ctx.vaultPath);
      const page = readPage(ctx.vaultPath, id, wiki);
      if (opts.json) return console.log(JSON.stringify(page, null, 2));
      console.log(`# ${page.frontmatter.title}\n[${page.frontmatter.type}] ${page.id} (updated: ${page.updated})\n\n${page.body}`);
    });
}
