import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });

describe('vault.trainer-submit-move', () => {
  beforeEach(() => {
    process.env.STADIUM_API_KEY = 'sk';
    process.env.STADIUM_BASE_URL = 'https://api.test';
  });

  it('POSTs move to /matches/:id/move', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ match_id: 'm1', turn: 5, status: 'in_progress' }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const { trainerSubmitMoveTool } = await import('../../src/tools/trainer-submit-move.js');
    const out = await trainerSubmitMoveTool.handler({ match_id: 'm1', turn: 5, move_id: 'ember-tdd-cycle' });
    expect(out.turn).toBe(5);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/matches/m1/move');
  });

  it('surfaces turn_mismatch error_code unchanged', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(
      JSON.stringify({ error_code: 'turn_mismatch', message: 'expected turn 6, got 5' }), { status: 409 }
    )));
    vi.stubGlobal('fetch', fetchMock);
    const { trainerSubmitMoveTool } = await import('../../src/tools/trainer-submit-move.js');
    await expect(
      trainerSubmitMoveTool.handler({ match_id: 'm1', turn: 5, move_id: 'ember-tdd-cycle' })
    ).rejects.toMatchObject({ error_code: 'turn_mismatch' });
  });
});
