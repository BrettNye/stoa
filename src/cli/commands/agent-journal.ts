import { Command } from "commander";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { serializeFrontmatter } from "../../core/frontmatter.js";
import { slugify } from "../../core/ids.js";
import { resolveWiki } from "../../tools/_resolve-wiki.js";
import { getCtx } from "../_ctx.js";
import { upsertPage } from "../../core/index.js";

export function registerAgentJournal(p: Command) {
  p.command("agent-journal <entry...>")
    .description("Append an agent journal entry")
    .option("--wiki <name>")
    .option("--agent-id <id>", "default: claude-code", "claude-code")
    .option("--session <id>")
    .option("--channel <name>")
    .action(async (entry: string[], opts) => {
      const ctx = getCtx();
      const wiki = resolveWiki(opts.wiki, ctx.defaultWiki, ctx.vaultPath);
      const text = entry.join(" ");
      const now = new Date();
      const date = now.toISOString().slice(0, 10);
      const time = now.toISOString().slice(11, 16).replace(":", "");
      const slug = slugify(text.split(/\s+/).slice(0, 6).join(" "));
      const id = `journal-${date}-${time}-${slug || "entry"}`;
      const fm: Record<string, any> = {
        id, title: `Journal — ${date} ${time}`, type: "journal", wiki,
        created: now.toISOString(), author: `agent:${opts.agentId}`
      };
      if (opts.session) fm.session_id = opts.session;
      if (opts.channel) fm.channel = opts.channel;
      const path = join(ctx.vaultPath, "wikis", wiki, "journal", `${id}.md`);
      writeFileSync(path, serializeFrontmatter(fm, text));
      await upsertPage(ctx.vaultPath, path);
      console.log(`logged: ${id}`);
    });
}
