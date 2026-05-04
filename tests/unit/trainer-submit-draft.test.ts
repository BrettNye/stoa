import { describe, it, expect, beforeEach, vi } from 'vitest';

// Six valid ULID-shaped strings used across tests
const VALID_ULIDS = [
  '01KQT6ST8AHV2XG9JN6QX7H5EX',
  '01KQT6ST8AHV2XG9JN6QX7H5EY',
  '01KQT6ST8AHV2XG9JN6QX7H5EZ',
  '01KQT6ST8AHV2XG9JN6QX7H5FA',
  '01KQT6ST8AHV2XG9JN6QX7H5FB',
  '01KQT6ST8AHV2XG9JN6QX7H5FC',
];

beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });

describe('vault.trainer-submit-draft', () => {
  beforeEach(() => {
    process.env.STADIUM_API_KEY = 'sk';
    process.env.STADIUM_BASE_URL = 'https://api.test';
    delete process.env.STADIUM_TRAINER;
  });

  it('rejects fewer than 6 picks before fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.doMock('../../src/core/resolve-trainer-context.js', () => ({
      resolveTrainerContext: () => ({ trainerSlug: 'brett', trainerId: 'trn_brett', wiki: 'default' })
    }));
    const { trainerSubmitDraftTool } = await import('../../src/tools/trainer-submit-draft.js');
    await expect(
      trainerSubmitDraftTool.handler({ match_id: '01KQT6ST8AHV2XG9JN6QX7H5EX', picks: VALID_ULIDS.slice(0, 2) } as any)
    ).rejects.toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects pf_-prefixed picks (regression for synthesis A1)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.doMock('../../src/core/resolve-trainer-context.js', () => ({
      resolveTrainerContext: () => ({ trainerSlug: 'brett', trainerId: 'trn_brett', wiki: 'default' })
    }));
    const { trainerSubmitDraftTool } = await import('../../src/tools/trainer-submit-draft.js');
    await expect(
      trainerSubmitDraftTool.handler({
        match_id: '01KQT6ST8AHV2XG9JN6QX7H5EX',
        picks: ['pf_aerodactyl', 'pf_charmeleon', 'pf_squirtle', 'pf_bulbasaur', 'pf_gastly', 'pf_mewtwo'],
      } as any)
    ).rejects.toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects picks not of ULID shape before fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.doMock('../../src/core/resolve-trainer-context.js', () => ({
      resolveTrainerContext: () => ({ trainerSlug: 'brett', trainerId: 'trn_brett', wiki: 'default' })
    }));
    const { trainerSubmitDraftTool } = await import('../../src/tools/trainer-submit-draft.js');
    await expect(
      trainerSubmitDraftTool.handler({
        match_id: '01KQT6ST8AHV2XG9JN6QX7H5EX',
        picks: [...VALID_ULIDS.slice(0, 5), 'bad_id']
      } as any)
    ).rejects.toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs 6 ULID picks to /matches/:id/draft', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ match_id: '01KQT6ST8AHV2XG9JN6QX7H5EX', status: 'in_progress' }), { status: 200 })
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.doMock('../../src/core/resolve-trainer-context.js', () => ({
      resolveTrainerContext: () => ({ trainerSlug: 'brett', trainerId: 'trn_brett_42', wiki: 'default' })
    }));
    const { trainerSubmitDraftTool } = await import('../../src/tools/trainer-submit-draft.js');
    const out = await trainerSubmitDraftTool.handler({
      match_id: '01KQT6ST8AHV2XG9JN6QX7H5EX',
      picks: VALID_ULIDS,
    });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/matches/01KQT6ST8AHV2XG9JN6QX7H5EX/draft');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ picks: VALID_ULIDS });
    expect((out as any).match_id).toBe('01KQT6ST8AHV2XG9JN6QX7H5EX');
    expect((out as any).status).toBe('in_progress');
  });

  it('includes caller_trainer_id in response matching resolveTrainerContext', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ match_id: '01KQT6ST8AHV2XG9JN6QX7H5EX', status: 'in_progress' }), { status: 200 })
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.doMock('../../src/core/resolve-trainer-context.js', () => ({
      resolveTrainerContext: () => ({ trainerSlug: 'brett', trainerId: 'trn_brett_99', wiki: 'default' })
    }));
    const { trainerSubmitDraftTool } = await import('../../src/tools/trainer-submit-draft.js');
    const out = await trainerSubmitDraftTool.handler({
      match_id: '01KQT6ST8AHV2XG9JN6QX7H5EX',
      picks: VALID_ULIDS,
    });
    expect((out as any).caller_trainer_id).toBe('trn_brett_99');
  });

  it('surfaces profile_not_owned via StadiumApiError on 422', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error_code: 'profile_not_owned', message: 'Trainer does not own profile' }),
          { status: 422 }
        )
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.doMock('../../src/core/resolve-trainer-context.js', () => ({
      resolveTrainerContext: () => ({ trainerSlug: 'brett', trainerId: 'trn_brett', wiki: 'default' })
    }));
    const { trainerSubmitDraftTool } = await import('../../src/tools/trainer-submit-draft.js');
    const { StadiumApiError } = await import('../../src/core/stadium-client.js');
    let caught: unknown;
    try {
      await trainerSubmitDraftTool.handler({
        match_id: '01KQT6ST8AHV2XG9JN6QX7H5EX',
        picks: VALID_ULIDS,
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
    vi.doMock('../../src/core/resolve-trainer-context.js', () => ({
      resolveTrainerContext: () => ({ trainerSlug: 'brett', trainerId: 'trn_brett', wiki: 'default' })
    }));
    const { trainerSubmitDraftTool } = await import('../../src/tools/trainer-submit-draft.js');
    const { StadiumApiError } = await import('../../src/core/stadium-client.js');
    let caught: unknown;
    try {
      await trainerSubmitDraftTool.handler({
        match_id: '01KQT6ST8AHV2XG9JN6QX7H5EX',
        picks: VALID_ULIDS,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(StadiumApiError);
    expect((caught as InstanceType<typeof StadiumApiError>).error_code).toBe('invalid_state_transition');
  });
});

describe('trainerSubmitDraftInput schema (unit)', () => {
  it('rejects pf_-prefixed picks (regression for synthesis A1)', async () => {
    const { trainerSubmitDraftInput } = await import('../../src/tools/trainer-submit-draft.js');
    const result = trainerSubmitDraftInput.safeParse({
      match_id: '01KQT6ST8AHV2XG9JN6QX7H5EX',
      picks: ['pf_aerodactyl', 'pf_charmeleon', 'pf_squirtle', 'pf_bulbasaur', 'pf_gastly', 'pf_mewtwo'],
    });
    expect(result.success).toBe(false);
  });

  it('accepts 6 ULID-shaped picks and a ULID match_id', async () => {
    const { trainerSubmitDraftInput } = await import('../../src/tools/trainer-submit-draft.js');
    const result = trainerSubmitDraftInput.safeParse({
      match_id: '01KQT6ST8AHV2XG9JN6QX7H5EX',
      picks: VALID_ULIDS,
    });
    expect(result.success).toBe(true);
  });

  it('rejects picks array of length != 6', async () => {
    const { trainerSubmitDraftInput } = await import('../../src/tools/trainer-submit-draft.js');
    const result = trainerSubmitDraftInput.safeParse({
      match_id: '01KQT6ST8AHV2XG9JN6QX7H5EX',
      picks: VALID_ULIDS.slice(0, 5),
    });
    expect(result.success).toBe(false);
  });
});
