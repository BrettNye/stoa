import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });

describe('vault.trainer-queue-match', () => {
  beforeEach(() => {
    process.env.STADIUM_API_KEY = 'sk';
    process.env.STADIUM_BASE_URL = 'https://api.test';
  });

  it('POSTs to /matches and returns match_id', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ match_id: 'm_42', status: 'pending_invite' }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const { trainerQueueMatchTool } = await import('../../src/tools/trainer-queue-match.js');
    const out = await trainerQueueMatchTool.handler({ opponent_trainer_id: 'trn_bob', ruleset: 'standard' });
    expect(out.match_id).toBe('m_42');
    expect(out.status).toBe('pending_invite');
    expect(fetchMock).toHaveBeenCalledWith('https://api.test/matches', expect.objectContaining({ method: 'POST' }));
    const init = fetchMock.mock.calls[0][1];
    expect(JSON.parse(init.body)).toEqual({ ruleset: 'standard', opponent_trainer_id: 'trn_bob' });
  });

  it('surfaces cannot_match_self via StadiumApiError', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error_code: 'cannot_match_self', message: 'cannot match self' }), { status: 400 })));
    vi.stubGlobal('fetch', fetchMock);
    const { trainerQueueMatchTool } = await import('../../src/tools/trainer-queue-match.js');
    await expect(
      trainerQueueMatchTool.handler({ opponent_trainer_id: 'trn_self', ruleset: 'standard' })
    ).rejects.toMatchObject({ name: 'StadiumApiError', error_code: 'cannot_match_self', status: 400 });
  });

  it('surfaces opponent_not_found via StadiumApiError', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error_code: 'opponent_not_found', message: 'no such trainer' }), { status: 404 })));
    vi.stubGlobal('fetch', fetchMock);
    const { trainerQueueMatchTool } = await import('../../src/tools/trainer-queue-match.js');
    await expect(
      trainerQueueMatchTool.handler({ opponent_trainer_id: 'trn_ghost', ruleset: 'standard' })
    ).rejects.toMatchObject({ name: 'StadiumApiError', error_code: 'opponent_not_found', status: 404 });
  });
});
