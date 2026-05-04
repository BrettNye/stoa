// vault-mcp/src/tools/trainer-init.ts
import { z } from 'zod';
import { join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { serializeFrontmatter } from '../core/frontmatter.js';
import { slugify } from '../core/ids.js';
import { resolveStadiumConfig } from '../core/stadium-config.js';
import { StadiumClient } from '../core/stadium-client.js';
import { upsertPage } from '../core/index.js';
import { resolveTrainerContext } from '../core/resolve-trainer-context.js';

const Input = z.object({
  name: z.string().min(1),
  strategy: z.string().min(1).optional()
});

export const trainerInitTool = {
  name: 'vault.trainer-init',
  description: 'Validate the configured Stadium API key and scaffold wikis/_agents/trainers/trainer-<name>.md with the initial strategy seed.',
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>, ctx: { vaultPath: string }) => {
    // trainer-init is special — it CREATES a trainer; resolveTrainerContext may not yet have
    // a target slug. Resolve only if env or toml provides one; otherwise fall through.
    let callerTrainerId: string | null = null;
    try {
      const trainerCtx = resolveTrainerContext({});
      callerTrainerId = trainerCtx.trainerId;
    } catch {
      // First-time init: no trainer configured yet — this is expected
    }

    const config = resolveStadiumConfig();
    const client = new StadiumClient({ api_key: config.api_key, base_url: config.base_url });
    await client.getHealth(); // validates connectivity + auth context

    const slug = slugify(input.name);
    const id = `trainer-${slug}`;
    const today = new Date().toISOString().slice(0, 10);
    const fm: Record<string, any> = {
      id,
      type: 'trainer',
      title: input.name,
      wiki: '_agents',
      status: 'active',
      created: today,
      updated: today,
      trainer_id: config.trainer_id,
      auto_accept_invites: true,
      preferred_roster: [],
      summary: `${input.name} — Stadium trainer`,
      tags: ['trainer', 'agent']
    };
    const body = input.strategy ?? '## Drafting\n\n(Describe how you want your trainer to draft 6 from your roster.)\n\n## Lead choice\n\n(Describe how to pick the opening Pokemon.)\n';
    const dir = join(ctx.vaultPath, 'wikis', '_agents', 'trainers');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${id}.md`);
    writeFileSync(path, serializeFrontmatter(fm, body));
    await upsertPage(ctx.vaultPath, path);
    return { id, path, trainer_id: config.trainer_id ?? null, caller_trainer_id: callerTrainerId };
  }
};
