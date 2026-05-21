// vault-mcp/src/tools/real-skill-register.ts
//
// Reads an existing `move-<id>/SKILL.md` from the active wiki's moves directory,
// calls Stadium's POST /real-skills/register with (skill_id, skill_md_content),
// and writes the returned `real_skill_id` and `combat:` advisory block back into
// the file's frontmatter. Per spec §5.2 the local `combat:` is advisory only —
// the server's `modifier_function` is canonical.
import { z } from "zod";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter, serializeFrontmatter } from "../core/frontmatter.js";
import { resolveStadiumConfig } from "../core/stadium-config.js";
import { StadiumClient } from "../core/stadium-client.js";
import { resolveWiki } from "./_resolve-wiki.js";
import { upsertPage } from "../core/index.js";
import type { ToolScope } from "../auth/types.js";

const Input = z.object({
  skill_id: z.string().regex(/^move-/),
  wiki: z.string().optional()
});

export const realSkillRegisterTool = {
  name: "vault_real-skill-register",
  description:
    "Register a real-skill (move-*/SKILL.md) with Stadium; persist returned real_skill_id + advisory combat block.",
  scope: {
    axis: () => 'stadium',
    adminOnly: () => true,
  } satisfies ToolScope,
  inputSchema: Input,
  handler: async (
    input: z.infer<typeof Input>,
    ctx: { vaultPath: string; defaultWiki?: string }
  ) => {
    const wiki = resolveWiki(input.wiki, ctx.defaultWiki, ctx.vaultPath);
    const path = join(
      ctx.vaultPath,
      "wikis",
      wiki,
      "moves",
      input.skill_id,
      "SKILL.md"
    );
    const raw = readFileSync(path, "utf8");

    const config = resolveStadiumConfig();
    const client = new StadiumClient({
      api_key: config.api_key,
      base_url: config.base_url
    });
    // StadiumApiError surfaces error_code (e.g. `modifier_clamped`,
    // `derivation_failed`) untouched — we let it propagate.
    const result = await client.registerRealSkill({
      skill_id: input.skill_id,
      skill_md_content: raw
    });

    const { frontmatter, body } = parseFrontmatter(raw);
    const updated = {
      ...frontmatter,
      real_skill_id: result.real_skill_id,
      // Advisory only — server's modifier_function is canonical (spec §5.2).
      combat: result.modifier_function
    };
    writeFileSync(path, serializeFrontmatter(updated, body));
    await upsertPage(ctx.vaultPath, path);
    return {
      real_skill_id: result.real_skill_id,
      modifier_function: result.modifier_function
    };
  }
};
