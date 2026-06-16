import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });

describe('vault_stadium-list mode=invites', () => {
  beforeEach(() => {
    process.env.STADIUM_API_KEY = 'sk';
    process.env.STADIUM_BASE_URL = 'https://api.test';
  });

  it('GETs /trainers/me/invites and returns the invites list', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      invites: [{ match_id: 'm_1', from_trainer_id: 'trn_alice', created_at: '2026-05-03T12:00:00Z' }]
    }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const { stadiumListTool } = await import('../../src/tools/stadium-list.js');
    const out = await stadiumListTool.handler({ mode: 'invites' }, {} as any);
    expect(out.invites).toHaveLength(1);
    expect(out.invites[0].match_id).toBe('m_1');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/trainers/me/invites');
  });

  it('returns {invites: []} for an empty list (200, not error)', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      invites: []
    }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const { stadiumListTool } = await import('../../src/tools/stadium-list.js');
    const out = await stadiumListTool.handler({ mode: 'invites' }, {} as any);
    expect(out.invites).toEqual([]);
  });

  it('scope.axis returns wikis/* unconditionally for invites mode', async () => {
    const { stadiumListTool } = await import('../../src/tools/stadium-list.js');
    expect(stadiumListTool.scope.axis({ mode: 'invites' })).toBe('wikis/*');
    expect(stadiumListTool.scope.axis({ mode: 'invites', wiki: 'alpha' })).toBe('wikis/alpha');
  });
});
