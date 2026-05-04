import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });

describe('vault.trainer-submit-move', () => {
  beforeEach(() => {
    process.env.STADIUM_API_KEY = 'sk';
    process.env.STADIUM_BASE_URL = 'https://api.test';
    // Deliberately NOT setting STADIUM_TRAINER — resolveStadiumConfig only needs
    // api_key + base_url; trainer ID comes from resolveTrainerContext (mocked below).
    delete process.env.STADIUM_TRAINER;
  });

  it('POSTs move to /matches/:id/move', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ match_id: 'm1', turn: 5, status: 'in_progress' }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    vi.doMock('../../src/core/resolve-trainer-context.js', () => ({
      resolveTrainerContext: () => ({ trainerSlug: 'ash', trainerId: 'trn_ash', wiki: 'default' })
    }));
    const { trainerSubmitMoveTool } = await import('../../src/tools/trainer-submit-move.js');
    const out = await trainerSubmitMoveTool.handler({ match_id: 'm1', turn: 5, move_id: 'ember-tdd-cycle' });
    expect(out.turn).toBe(5);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/matches/m1/move');
  });

  it('includes caller_trainer_id in response matching resolveTrainerContext', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ match_id: 'm1', turn: 3, status: 'in_progress' }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    vi.doMock('../../src/core/resolve-trainer-context.js', () => ({
      resolveTrainerContext: () => ({ trainerSlug: 'ash', trainerId: 'trn_ash_99', wiki: 'default' })
    }));
    const { trainerSubmitMoveTool } = await import('../../src/tools/trainer-submit-move.js');
    const out = await trainerSubmitMoveTool.handler({ match_id: 'm1', turn: 3, move_id: 'ember-tdd-cycle' });
    expect(out.caller_trainer_id).toBe('trn_ash_99');
  });

  it('input schema accepts match_id, turn, move_id and optional target', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ match_id: 'm2', turn: 1, status: 'in_progress' }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    vi.doMock('../../src/core/resolve-trainer-context.js', () => ({
      resolveTrainerContext: () => ({ trainerSlug: 'ash', trainerId: 'trn_ash', wiki: 'default' })
    }));
    const { trainerSubmitMoveTool } = await import('../../src/tools/trainer-submit-move.js');
    const out = await trainerSubmitMoveTool.handler({ match_id: 'm2', turn: 1, move_id: 'flamethrower', target: 'opp_pf_1' });
    expect(out.match_id).toBe('m2');
  });

  it('surfaces turn_mismatch error_code unchanged', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(
      JSON.stringify({ error_code: 'turn_mismatch', message: 'expected turn 6, got 5' }), { status: 409 }
    )));
    vi.stubGlobal('fetch', fetchMock);
    vi.doMock('../../src/core/resolve-trainer-context.js', () => ({
      resolveTrainerContext: () => ({ trainerSlug: 'ash', trainerId: 'trn_ash', wiki: 'default' })
    }));
    const { trainerSubmitMoveTool } = await import('../../src/tools/trainer-submit-move.js');
    await expect(
      trainerSubmitMoveTool.handler({ match_id: 'm1', turn: 5, move_id: 'ember-tdd-cycle' })
    ).rejects.toMatchObject({ error_code: 'turn_mismatch' });
  });

  it('surfaces move_not_owned error_code unchanged', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(
      JSON.stringify({ error_code: 'move_not_owned', message: 'trainer does not own that move' }), { status: 403 }
    )));
    vi.stubGlobal('fetch', fetchMock);
    vi.doMock('../../src/core/resolve-trainer-context.js', () => ({
      resolveTrainerContext: () => ({ trainerSlug: 'ash', trainerId: 'trn_ash', wiki: 'default' })
    }));
    const { trainerSubmitMoveTool } = await import('../../src/tools/trainer-submit-move.js');
    await expect(
      trainerSubmitMoveTool.handler({ match_id: 'm1', turn: 5, move_id: 'ember-tdd-cycle' })
    ).rejects.toMatchObject({ error_code: 'move_not_owned' });
  });
});
