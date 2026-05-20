// vault-mcp/src/tools/process-inbox.ts
import { z } from "zod";
import { basename } from "node:path";
import { listInbox, promoteInboxItem } from "../core/inbox.js";
import { NoteType } from "../core/frontmatter.js";
import { resolveWiki } from "./_resolve-wiki.js";

const Item = z.object({
  inbox_path: z.string(),
  type: NoteType,
  id: z.string(),
  title: z.string().optional()
});

const Input = z.object({
  wiki: z.string().optional(),
  commit: z.boolean().default(false),
  item_id: z.string().optional(),
  items: z.array(Item).optional()
});

export const processInboxTool = {
  name: "vault_process-inbox",
  description: "Two-phase: (1) commit:false returns proposed type+id+title for each inbox item; (2) commit:true with items[] moves and adds frontmatter.",
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>, ctx: { vaultPath: string; defaultWiki?: string }) => {
    const wiki = resolveWiki(input.wiki, ctx.defaultWiki, ctx.vaultPath);
    if (!input.commit) {
      const items = listInbox(ctx.vaultPath, wiki);
      return {
        proposals: items.map(p => ({
          inbox_path: p,
          suggested_type: "idea" as const,
          // Bug-2026-05-15 #1 fix — use node:path.basename so the slug source
          // is the *filename* regardless of OS path separator. The historical
          // `p.split("/").pop()` left Windows backslashed paths intact and
          // baked the full absolute path into the suggested_id.
          suggested_id: `idea-${basename(p).replace(/^\d{4}-\d{2}-\d{2}-\d{4}-/, "").replace(/\.md$/, "")}`,
          rationale: "default heuristic: untyped capture promoted as idea"
        }))
      };
    }
    if (!input.items || input.items.length === 0) {
      throw new Error("commit=true requires items[]");
    }
    const promoted = input.items.map(it => promoteInboxItem(ctx.vaultPath, {
      inbox_path: it.inbox_path,
      type: it.type,
      id: it.id,
      wiki,
      title: it.title
    }));
    return { promoted, log_entries_written: promoted.length };
  }
};
