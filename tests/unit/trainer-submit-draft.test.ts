import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });

describe('vault.trainer-submit-draft', () => {
  beforeEach(() => {
    process.env.STADIUM_API_KEY = 'sk';
    process.env.STADIUM_BASE_URL = 'https://api.test';
  });

  it('rejects fewer than 6 picks before fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { trainerSubmitDraftTool } = await import('../../src/tools/trainer-submit-draft.js');
    await expect(
      trainerSubmitDraftTool.handler({ match_id: 'm1', picks: ['pf_1', 'pf_2'] } as any)
    ).rejects.toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects picks not matching ^pf_ prefix before fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { trainerSubmitDraftTool } = await import('../../src/tools/trainer-submit-draft.js');
    await expect(
      trainerSubmitDraftTool.handler({
        match_id: 'm1',
        picks: ['pf_1', 'pf_2', 'pf_3', 'pf_4', 'pf_5', 'bad_id']
      } as any)
    ).rejects.toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs 6 picks to /matches/:id/draft', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ match_id: 'm1', status: 'in_progress' }), { status: 200 })
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const { trainerSubmitDraftTool } = await import('../../src/tools/trainer-submit-draft.js');
    const out = await trainerSubmitDraftTool.handler({
      match_id: 'm1',
      picks: ['pf_1', 'pf_2', 'pf_3', 'pf_4', 'pf_5', 'pf_6']
    });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/matches/m1/draft');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ picks: ['pf_1', 'pf_2', 'pf_3', 'pf_4', 'pf_5', 'pf_6'] });
    expect(out).toEqual({ match_id: 'm1', status: 'in_progress' });
  });

  it('surfaces profile_not_owned via StadiumApiError on 422', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error_code: 'profile_not_owned', message: 'Trainer does not own pf_x' }),
          { status: 422 }
        )
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const { trainerSubmitDraftTool } = await import('../../src/tools/trainer-submit-draft.js');
    const { StadiumApiError } = await import('../../src/core/stadium-client.js');
    let caught: unknown;
    try {
      await trainerSubmitDraftTool.handler({
        match_id: 'm1',
        picks: ['pf_1', 'pf_2', 'pf_3', 'pf_4', 'pf_5', 'pf_6']
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(StadiumApiError);
    expect((caught as InstanceType<typeof StadiumApiError>).error_code).toBe('profile_not_owned');
  });

  it('surfaces invalid_state_transition via StadiumApiError on 409', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error_code: 'invalid_state_transition', message: 'match is not drafting' }),
          { status: 409 }
        )
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const { trainerSubmitDraftTool } = await import('../../src/tools/trainer-submit-draft.js');
    const { StadiumApiError } = await import('../../src/core/stadium-client.js');
    let caught: unknown;
    try {
      await trainerSubmitDraftTool.handler({
        match_id: 'm1',
        picks: ['pf_1', 'pf_2', 'pf_3', 'pf_4', 'pf_5', 'pf_6']
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(StadiumApiError);
    expect((caught as InstanceType<typeof StadiumApiError>).error_code).toBe('invalid_state_transition');
  });
});
