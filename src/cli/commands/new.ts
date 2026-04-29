import { Command } from "commander";
import { writePage } from "../../core/pages.js";
import { generateId } from "../../core/ids.js";
import { NoteType } from "../../core/frontmatter.js";
import { getCtx } from "../_ctx.js";

export function registerNew(p: Command) {
  p.command("new <type> <wiki> <title>")
    .description("Create a typed page from the template")
    .action(async (type, wiki, title) => {
      const ctx = getCtx();
      const t = NoteType.parse(type);
      const today = new Date().toISOString().slice(0, 10);
      const time = new Date().toISOString().slice(11, 16).replace(":", "");
      const id = generateId(t, title, today, time);
      const r = writePage(ctx.vaultPath, {
        id, type: t, wiki,
        frontmatter: { id, title, type: t, wiki, created: today, status: "draft" },
        body: `# ${title}\n\n`
      });
      console.log(`created: ${r.id} at ${r.path}`);
    });
}
