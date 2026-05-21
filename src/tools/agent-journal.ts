// vault-mcp/src/tools/agent-journal.ts
import { z } from "zod";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolScope } from "../auth/types.js";
import { serializeFrontmatter } from "../core/frontmatter.js";
import { slugify } from "../core/ids.js";
import { resolveWiki } from "./_resolve-wiki.js";
import { upsertPage } from "../core/index.js";

const Input = z.object({
  entry: z.string().min(1),
  wiki: z.string().optional(),
  // agent_id REMOVED — server stamps from principal
  session_id: z.string().optional(),
  channel: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).optional(),
  duration_minutes: z.number().int().nonnegative().optional(),
});

const scope: ToolScope = {
  axis: (input: any) => {
    const wiki = (input as { wiki?: string }).wiki;
    return `wikis/${wiki ?? "_unknown"}/journal`;
  },
};

export const agentJournalTool = {
  name: "vault_agent-journal",
  description: "Append a first-person agent journal entry to <wiki>/journal/. Auto-fills author, created, session.",
  inputSchema: Input,
  scope,
  handler: async (
    input: z.infer<typeof Input>,
    ctx: { vaultPath: string; defaultWiki?: string; principal?: { agent_id: string } },
  ) => {
    const wiki = resolveWiki(input.wiki, ctx.defaultWiki, ctx.vaultPath);
    const agent_id = ctx.principal?.agent_id ?? "stoa-local";
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toISOString().slice(11, 16).replace(":", "");
    const slug = slugify(input.entry.split(/\s+/).slice(0, 6).join(" "));
    const id = `journal-${date}-${time}-${slug || "entry"}`;
    const path = join(ctx.vaultPath, "wikis", wiki, "journal", `${id}.md`);
    const fm: Record<string, any> = {
      id,
      title: `Journal — ${date} ${time}`,
      type: "journal",
      wiki,
      created: now.toISOString(),
      author: `agent:${agent_id}`,
    };
    if (input.session_id) fm.session_id = input.session_id;
    if (input.channel) fm.channel = input.channel;
    if (input.duration_minutes !== undefined) fm.duration_minutes = input.duration_minutes;
    writeFileSync(path, serializeFrontmatter(fm, input.entry));
    await upsertPage(ctx.vaultPath, path);
    return { id, path, created: fm.created };
  },
};
