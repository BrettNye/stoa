import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });

describe('vault.match-watch', () => {
  const vaultPath = join(tmpdir(), 'vault-match-watch-' + Date.now() + '-' + Math.random());
  beforeEach(() => {
    mkdirSync(join(vaultPath, 'wikis', 'alpha', 'journal'), { recursive: true });
    mkdirSync(join(vaultPath, '_index'), { recursive: true });
    process.env.STADIUM_API_KEY = 'sk';
    process.env.STADIUM_BASE_URL = 'https://api.test';
  });
  afterEach(() => rmSync(vaultPath, { recursive: true, force: true }));

  it('polls until completed and writes a result journal', async () => {
    const responses = [
      new Response(JSON.stringify({ match_id: 'm1', status: 'in_progress', turn: 5, events: [{ turn: 1 }, { turn: 2 }], state: {} }), { status: 200 }),
      new Response(JSON.stringify({ match_id: 'm1', status: 'completed', turn: 12, events: [{ turn: 1 }, { turn: 2 }, { turn: 12, winner: 'a' }], state: {} }), { status: 200 })
    ];
    let idx = 0;
    const fetchMock = vi.fn(() => Promise.resolve(responses[idx++]));
    vi.stubGlobal('fetch', fetchMock);
    const { matchWatchTool } = await import('../../src/tools/match-watch.js');
    const out = await matchWatchTool.handler(
      { match_id: 'm1', poll_interval_ms: 1, max_wait_ms: 1000 },
      { vaultPath, defaultWiki: 'alpha' }
    );
    expect(out.status).toBe('completed');
    expect(existsSync(out.journal_path)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('hits /matches/:id/state on the spectator endpoint', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(
      new Response(JSON.stringify({ match_id: 'm2', status: 'completed', turn: 1, events: [], state: {} }), { status: 200 })
    ));
    vi.stubGlobal('fetch', fetchMock);
    const { matchWatchTool } = await import('../../src/tools/match-watch.js');
    await matchWatchTool.handler(
      { match_id: 'm2', poll_interval_ms: 1, max_wait_ms: 1000 },
      { vaultPath, defaultWiki: 'alpha' }
    );
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/matches/m2/state');
  });

  it('throws when max_wait_ms elapses before terminal status', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(
      new Response(JSON.stringify({ match_id: 'm3', status: 'in_progress', turn: 1, events: [], state: {} }), { status: 200 })
    ));
    vi.stubGlobal('fetch', fetchMock);
    const { matchWatchTool } = await import('../../src/tools/match-watch.js');
    await expect(
      matchWatchTool.handler(
        { match_id: 'm3', poll_interval_ms: 1, max_wait_ms: 5 },
        { vaultPath, defaultWiki: 'alpha' }
      )
    ).rejects.toThrow(/did not terminate/);
  });

  it('treats forfeit_a as a terminal status', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(
      new Response(JSON.stringify({ match_id: 'm4', status: 'forfeit_a', turn: 3, events: [{ turn: 3, kind: 'forfeit' }], state: {} }), { status: 200 })
    ));
    vi.stubGlobal('fetch', fetchMock);
    const { matchWatchTool } = await import('../../src/tools/match-watch.js');
    const out = await matchWatchTool.handler(
      { match_id: 'm4', poll_interval_ms: 1, max_wait_ms: 1000 },
      { vaultPath, defaultWiki: 'alpha' }
    );
    expect(out.status).toBe('forfeit_a');
  });

  it('writes a journal with frontmatter + events JSON to the active wiki', async () => {
    const events = [{ turn: 1, kind: 'opened' }, { turn: 7, kind: 'ko', winner: 'b' }];
    const fetchMock = vi.fn(() => Promise.resolve(
      new Response(JSON.stringify({ match_id: 'm5', status: 'completed', turn: 7, events, state: {} }), { status: 200 })
    ));
    vi.stubGlobal('fetch', fetchMock);
    const { matchWatchTool } = await import('../../src/tools/match-watch.js');
    const out = await matchWatchTool.handler(
      { match_id: 'm5', poll_interval_ms: 1, max_wait_ms: 1000 },
      { vaultPath, defaultWiki: 'alpha' }
    );
    expect(out.journal_path).toContain(join('wikis', 'alpha', 'journal'));
    expect(out.journal_path).toMatch(/journal-\d{4}-\d{2}-\d{2}-\d{4}-match-m5\.md$/);
    const raw = readFileSync(out.journal_path, 'utf8');
    expect(raw).toContain('type: journal');
    expect(raw).toContain('Match m5');
    expect(raw).toContain('completed');
    expect(raw).toContain('"kind": "opened"');
    expect(raw).toContain('"kind": "ko"');
  });
});
