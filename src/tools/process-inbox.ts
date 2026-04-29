// vault-mcp/src/tools/process-inbox.ts
import { z } from "zod";
import { listInbox, promoteInboxItem } from "../core/inbox.js";
import { NoteType } from "../core/frontmatter.js";
import { resolveWiki } from "./_resolve-wiki.js";

const ProposalInput = z.object({
  wiki: z.string().optional(),
  commit: z.literal(false).default(false),
  item_id: z.string().optional()
});

const CommitInput = z.object({
  wiki: z.string().optional(),
  commit: z.literal(true),
  items: z.array(z.object({
    inbox_path: z.string(),
    type: NoteType,
    id: z.string(),
    title: z.string().optional()
  }))
});

const Input = z.union([ProposalInput, CommitInput]);

export const processInboxTool = {
  name: "vault.process-inbox",
  description: "Two-phase: (1) commit:false returns proposed type+id+title for each inbox item; (2) commit:true with confirmed items moves and adds frontmatter.",
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>, ctx: { vaultPath: string; defaultWiki?: string }) => {
    const wiki = resolveWiki(input.wiki, ctx.defaultWiki, ctx.vaultPath);
    if (!input.commit) {
      const items = listInbox(ctx.vaultPath, wiki);
      return {
        proposals: items.map(p => ({
          inbox_path: p,
          suggested_type: "idea" as const,
          suggested_id: `idea-${p.split("/").pop()?.replace(/^\d{4}-\d{2}-\d{2}-\d{4}-/, "").replace(/\.md$/, "")}`,
          rationale: "default heuristic: untyped capture promoted as idea"
        }))
      };
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
