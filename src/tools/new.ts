// vault-mcp/src/tools/new.ts
import { z } from "zod";
import { writePage } from "../core/pages.js";
import { NoteType, PageStatus } from "../core/frontmatter.js";
import { generateId } from "../core/ids.js";

const Input = z.object({
  type: NoteType,
  wiki: z.string(),
  title: z.string().min(1),
  frontmatter: z.record(z.any()).optional(),
  body: z.string().optional(),
  status: PageStatus.default("draft")
});

export const newTool = {
  name: "vault.new",
  description: "Create a typed page from the template, with required frontmatter pre-filled.",
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>, ctx: { vaultPath: string }) => {
    const today = new Date().toISOString().slice(0, 10);
    const time = new Date().toISOString().slice(11, 16).replace(":", "");
    const id = generateId(input.type, input.title, today, time);
    const fm = {
      id, title: input.title, type: input.type, wiki: input.wiki,
      created: today, status: input.status,
      ...(input.frontmatter ?? {})
    };
    return writePage(ctx.vaultPath, {
      id, type: input.type, wiki: input.wiki,
      frontmatter: fm, body: input.body ?? `# ${input.title}\n\n`
    });
  }
};
