import { z } from 'zod';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter, serializeFrontmatter } from '../core/frontmatter.js';
import { resolveStadiumConfig } from '../core/stadium-config.js';
import { StadiumClient } from '../core/stadium-client.js';
import { resolveWiki } from './_resolve-wiki.js';
import { upsertPage } from '../core/index.js';
import type { ToolScope } from '../auth/types.js';

const Input = z.object({
  skill_id: z.string().regex(/^move-/),
  wiki: z.string().optional()
});

export const realSkillRefreshTool = {
  name: 'vault_real-skill-refresh',
  description:
    "Re-derive a registered real-skill's modifier function from the current SKILL.md content.",
  scope: {
    axis: () => 'stadium',
    adminOnly: () => true,
  } satisfies ToolScope,
  inputSchema: Input,
  handler: async (
    input: unknown,
    ctx: { vaultPath: string; defaultWiki?: string }
  ) => {
    const parsed = Input.parse(input);
    const wiki = resolveWiki(parsed.wiki, ctx.defaultWiki, ctx.vaultPath);
    const path = join(
      ctx.vaultPath,
      'wikis',
      wiki,
      'moves',
      parsed.skill_id,
      'SKILL.md'
    );
    const raw = readFileSync(path, 'utf8');
    const { frontmatter, body } = parseFrontmatter(raw);
    const real_skill_id = (frontmatter as Record<string, unknown>).real_skill_id;
    if (!real_skill_id) {
      throw new Error(
        `${parsed.skill_id} has no real_skill_id — register first via vault_real-skill-register`
      );
    }

    const config = resolveStadiumConfig();
    const client = new StadiumClient({
      api_key: config.api_key,
      base_url: config.base_url
    });
    const result = await client.refreshRealSkill(String(real_skill_id), {
      skill_md_content: raw
    });

    const updated = { ...frontmatter, combat: result.modifier_function };
    writeFileSync(path, serializeFrontmatter(updated, body));
    await upsertPage(ctx.vaultPath, path);
    return {
      real_skill_id: result.real_skill_id,
      modifier_function: result.modifier_function
    };
  }
};
