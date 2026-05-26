// vault-mcp/src/tools/match-watch.ts
import { z } from 'zod';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serializeFrontmatter } from '../core/frontmatter.js';
import { resolveStadiumConfig } from '../core/stadium-config.js';
import { StadiumClient } from '../core/stadium-client.js';
import { resolveWiki } from './_resolve-wiki.js';
import { upsertPage } from '../core/index.js';
import type { ToolScope } from '../auth/types.js';

const TERMINAL = new Set(['completed', 'forfeit_a', 'forfeit_b', 'draw']);

const Input = z.object({
  match_id: z.string().min(1),
  wiki: z.string().optional(),
  poll_interval_ms: z.number().int().positive().default(1500),
  max_wait_ms: z.number().int().positive().default(10 * 60 * 1000) // 10 minutes
});

interface SpectatorState {
  match_id: string;
  status: string;
  turn: number;
  events: Array<Record<string, unknown>>;
  state: Record<string, unknown> | null;
}

export const matchWatchTool = {
  name: 'vault_match-watch',
  description: 'Poll a match until terminal, then write a result journal.',
  scope: {
    axis: (i: unknown) => {
      const match_id = (i as Record<string, unknown>)?.match_id;
      return `matches/${typeof match_id === 'string' ? match_id : '*'}`;
    },
  } satisfies ToolScope,
  inputSchema: Input,
  handler: async (
    input: z.infer<typeof Input>,
    ctx: { vaultPath: string; defaultWiki?: string }
  ): Promise<{ match_id: string; status: string; journal_path: string }> => {
    const parsed = Input.parse(input);
    const wiki = resolveWiki(parsed.wiki, ctx.defaultWiki, ctx.vaultPath);
    const config = resolveStadiumConfig();
    const client = new StadiumClient({ api_key: config.api_key, base_url: config.base_url });

    const start = Date.now();
    let last: SpectatorState | undefined;
    while (Date.now() - start < parsed.max_wait_ms) {
      last = await client.getSpectatorState(parsed.match_id);
      if (TERMINAL.has(last.status)) break;
      await new Promise(resolve => setTimeout(resolve, parsed.poll_interval_ms));
    }
    if (!last || !TERMINAL.has(last.status)) {
      throw new Error(
        `match ${parsed.match_id} did not terminate within ${parsed.max_wait_ms}ms (last status: ${last?.status ?? 'unknown'})`
      );
    }

    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toISOString().slice(11, 16).replace(':', '');
    const id = `journal-${date}-${time}-match-${parsed.match_id}`;
    const path = join(ctx.vaultPath, 'wikis', wiki, 'journal', `${id}.md`);
    const fm = {
      id,
      type: 'journal',
      title: `Match ${parsed.match_id} — ${last.status}`,
      wiki,
      created: now.toISOString(),
      tags: ['match', 'stadium'],
      summary: `Stadium match ${parsed.match_id} terminated with status ${last.status}`
    };
    const body =
      `## Outcome\n\n` +
      `- status: ${last.status}\n` +
      `- final turn: ${last.turn}\n` +
      `- events: ${last.events.length}\n\n` +
      `## Events\n\n` +
      '```json\n' +
      JSON.stringify(last.events, null, 2) +
      '\n```\n';
    writeFileSync(path, serializeFrontmatter(fm, body));
    await upsertPage(ctx.vaultPath, path);
    return { match_id: parsed.match_id, status: last.status, journal_path: path };
  }
};
