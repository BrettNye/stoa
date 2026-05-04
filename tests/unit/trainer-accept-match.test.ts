import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });

describe('vault.trainer-accept-match', () => {
  beforeEach(() => {
    process.env.STADIUM_API_KEY = 'sk';
    process.env.STADIUM_BASE_URL = 'https://api.test';
  });

  it('POSTs to /matches/:id/accept and returns drafting status', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ match_id: 'm_1', status: 'drafting' }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const { trainerAcceptMatchTool } = await import('../../src/tools/trainer-accept-match.js');
    const out = await trainerAcceptMatchTool.handler({ match_id: 'm_1' });
    expect(out.match_id).toBe('m_1');
    expect(out.status).toBe('drafting');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/matches/m_1/accept');
  });

  it('surfaces match_not_found via StadiumApiError on 404', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error_code: 'match_not_found', message: 'no such match' }), { status: 404 })));
    vi.stubGlobal('fetch', fetchMock);
    const { trainerAcceptMatchTool } = await import('../../src/tools/trainer-accept-match.js');
    const { StadiumApiError } = await import('../../src/core/stadium-client.js');
    await expect(trainerAcceptMatchTool.handler({ match_id: 'm_missing' })).rejects.toBeInstanceOf(StadiumApiError);
  });

  it('surfaces not_invitee via StadiumApiError on 403', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error_code: 'not_invitee', message: 'caller is not the invitee for this match' }), { status: 403 })));
    vi.stubGlobal('fetch', fetchMock);
    const { trainerAcceptMatchTool } = await import('../../src/tools/trainer-accept-match.js');
    const { StadiumApiError } = await import('../../src/core/stadium-client.js');
    await expect(trainerAcceptMatchTool.handler({ match_id: 'm_1' })).rejects.toBeInstanceOf(StadiumApiError);
  });

  it('surfaces invalid_state_transition via StadiumApiError on 409', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error_code: 'invalid_state_transition', message: 'match is not in pending_invite state' }), { status: 409 })));
    vi.stubGlobal('fetch', fetchMock);
    const { trainerAcceptMatchTool } = await import('../../src/tools/trainer-accept-match.js');
    const { StadiumApiError } = await import('../../src/core/stadium-client.js');
    await expect(trainerAcceptMatchTool.handler({ match_id: 'm_1' })).rejects.toBeInstanceOf(StadiumApiError);
  });
});
