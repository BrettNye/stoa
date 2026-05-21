// vault-mcp/src/tools/new.ts
import { z } from "zod";
import { writePage } from "../core/pages.js";
import { NoteType, PageStatus } from "../core/frontmatter.js";
import { generateId } from "../core/ids.js";
import { upsertPage } from "../core/index.js";
import type { ToolScope } from "../auth/types.js";

const Input = z.object({
  type: NoteType,
  wiki: z.string(),
  title: z.string().min(1),
  frontmatter: z.record(z.any()).optional(),
  body: z.string().optional(),
  status: PageStatus.default("draft")
});

const scope: ToolScope = {
  axis: (i: any) => `wikis/${i.wiki}/${i.type}`,
  adminOnly: (i: any) => i.type === "map",
};

export const newTool = {
  name: "vault_new",
  description: "Create a typed page from the template, with required frontmatter pre-filled.",
  inputSchema: Input,
  scope,
  handler: async (input: z.infer<typeof Input>, ctx: { vaultPath: string }) => {
    const today = new Date().toISOString().slice(0, 10);
    const time = new Date().toISOString().slice(11, 16).replace(":", "");
    const id = generateId(input.type, input.title, today, time);
    const fm = {
      id, title: input.title, type: input.type, wiki: input.wiki,
      created: today, status: input.status,
      ...(input.frontmatter ?? {})
    };
    const result = writePage(ctx.vaultPath, {
      id, type: input.type, wiki: input.wiki,
      frontmatter: fm, body: input.body ?? `# ${input.title}\n\n`
    });
    // v1.7 §5.1 — write-through index update so the new page is immediately
    // visible to loadIndex-based tools (recall, channel-tail, merge-queue,
    // start, lint) without requiring a manual reindex.
    await upsertPage(ctx.vaultPath, result.path);
    return result;
  }
};
