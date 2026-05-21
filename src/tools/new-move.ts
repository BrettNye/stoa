// vault-mcp/src/tools/new-move.ts
//
// Thin wrapper around the underlying writePage primitive that pre-fills the
// v1.5 substrate frontmatter required for `type: move` plus the SKILL.md
// open-standard fields (name, description) and the standard `## When to use`
// and `## How to apply` body headings. writePage already routes type=move
// through the directory layout (moves/<id>/SKILL.md) — we do not reimplement
// that here.
//
// See wikis/_agents/CLAUDE.md for the substrate field contract.
import { z } from "zod";
import { writePage } from "../core/pages.js";
import { upsertPage } from "../core/index.js";
import { slugify } from "../core/ids.js";
import { resolveWiki } from "./_resolve-wiki.js";
import type { ToolScope } from "../auth/types.js";

const Input = z.object({
  title: z.string().min(1),
  wiki: z.string().optional(),
  name: z.string().optional(),
  description: z.string().min(1),
  move_type: z.enum(["process", "capability", "domain", "support"]).default("process"),
  applies_to: z.array(z.string()).default(["claude-code"]),
  pokemon_type: z.string().optional(),
  tools_used: z.array(z.string()).default([])
});

const scope: ToolScope = {
  axis: (i: any) => `wikis/${i.wiki ?? "_agents"}/moves/${i.move_id ?? "*"}`,
  adminOnly: () => true,
};

export const newMoveTool = {
  name: "vault_new-move",
  description: "Scaffold a new move (portable SKILL.md) with v1.5 substrate frontmatter and standard headings pre-filled. Use this instead of vault_new when creating moves.",
  inputSchema: Input,
  scope,
  handler: async (
    input: unknown,
    ctx: { vaultPath: string; defaultWiki?: string }
  ) => {
    const parsed = Input.parse(input);
    const wiki = resolveWiki(parsed.wiki, ctx.defaultWiki, ctx.vaultPath);

    const slug = slugify(parsed.title);
    const id = `move-${slug}`;
    // SKILL.md open-standard `name:` field. Defaults to the title slug so the
    // file works as a portable skill in any runtime (Claude Code, OpenClaw,
    // Codex, Gemini CLI) without manual edits.
    const name = parsed.name?.trim() || slug;

    const today = new Date().toISOString().slice(0, 10);

    const frontmatter: Record<string, any> = {
      id,
      title: parsed.title,
      type: "move",
      wiki,
      created: today,
      status: "draft",
      // SKILL.md open-standard fields
      name,
      description: parsed.description,
      // Vault-substrate fields
      move_type: parsed.move_type,
      applies_to: parsed.applies_to,
      tools_used: parsed.tools_used
    };
    // pokemon_type is optional on moves — only include when supplied so we
    // don't pollute the frontmatter with empty fields.
    if (parsed.pokemon_type) {
      frontmatter.pokemon_type = parsed.pokemon_type;
    }

    const body = [
      `# ${parsed.title}`,
      "",
      "## When to use",
      "",
      "TODO: describe the conditions under which this move applies.",
      "",
      "## How to apply",
      "",
      "TODO: describe the step-by-step procedure the agent follows.",
      ""
    ].join("\n");

    const result = writePage(ctx.vaultPath, {
      id, type: "move", wiki,
      frontmatter, body
    });
    // v1.7 §5.1 — write-through index update so the new move is immediately
    // visible to loadIndex-based tools (recall, sync-skills, sync-agents)
    // without requiring a manual reindex.
    await upsertPage(ctx.vaultPath, result.path);

    return {
      id: result.id,
      path: result.path,
      skill_md_path: result.path
    };
  }
};
