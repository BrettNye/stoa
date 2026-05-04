import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });

describe('vault.trainer-get-state', () => {
  beforeEach(() => {
    process.env.STADIUM_API_KEY = 'sk';
    process.env.STADIUM_BASE_URL = 'https://api.test';
  });

  it('GETs /matches/:id with optional ?since=N', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ match_id: 'm1', status: 'in_progress', turn: 5, events: [], state: {} }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const { trainerGetStateTool } = await import('../../src/tools/trainer-get-state.js');
    await trainerGetStateTool.handler({ match_id: 'm1', since_turn: 3 });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/matches/m1?since=3');
  });

  it('GETs /matches/:id with no query string when since_turn is undefined', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ match_id: 'm1', status: 'in_progress', turn: 0, events: [], state: {} }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const { trainerGetStateTool } = await import('../../src/tools/trainer-get-state.js');
    await trainerGetStateTool.handler({ match_id: 'm1' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/matches/m1');
  });

  it('returns the full state envelope unchanged', async () => {
    const envelope = { match_id: 'm1', status: 'in_progress', turn: 7, events: [{ kind: 'move' }], state: { hp: 42 } };
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify(envelope), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const { trainerGetStateTool } = await import('../../src/tools/trainer-get-state.js');
    const result = await trainerGetStateTool.handler({ match_id: 'm1', since_turn: 0 });
    expect(result).toEqual(envelope);
  });
});
