import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });

describe('vault.move-fuse', () => {
  beforeEach(() => {
    process.env.STADIUM_API_KEY = 'sk';
    process.env.STADIUM_BASE_URL = 'https://api.test';
  });

  it('POSTs to /moves/fuse and returns move_id', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ move_id: 'ember-tdd-cycle' }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const { moveFuseTool } = await import('../../src/tools/move-fuse.js');
    const out = await moveFuseTool.handler({ canonical_move_name: 'ember', real_skill_id: 'rs_tdd' });
    expect(out.move_id).toBe('ember-tdd-cycle');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/moves/fuse');
  });

  it('rejects non-kebab-case canonical_move_name before hitting the network', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ move_id: 'x' }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const { moveFuseTool } = await import('../../src/tools/move-fuse.js');
    await expect(
      moveFuseTool.handler({ canonical_move_name: 'Ember_Punch', real_skill_id: 'rs_tdd' })
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects empty real_skill_id before hitting the network', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ move_id: 'x' }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const { moveFuseTool } = await import('../../src/tools/move-fuse.js');
    await expect(
      moveFuseTool.handler({ canonical_move_name: 'ember', real_skill_id: '' })
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces pokeapi_unknown_move via StadiumApiError', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(
        JSON.stringify({ error_code: 'pokeapi_unknown_move', message: 'Unknown move' }),
        { status: 422 }
      ))
    );
    vi.stubGlobal('fetch', fetchMock);
    const { moveFuseTool } = await import('../../src/tools/move-fuse.js');
    const { StadiumApiError } = await import('../../src/core/stadium-client.js');
    let caught: unknown;
    try {
      await moveFuseTool.handler({ canonical_move_name: 'fakemove', real_skill_id: 'rs_tdd' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(StadiumApiError);
    expect((caught as InstanceType<typeof StadiumApiError>).error_code).toBe('pokeapi_unknown_move');
  });

  it('surfaces unknown_real_skill_id via StadiumApiError', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(
        JSON.stringify({ error_code: 'unknown_real_skill_id', message: 'Unknown real skill' }),
        { status: 422 }
      ))
    );
    vi.stubGlobal('fetch', fetchMock);
    const { moveFuseTool } = await import('../../src/tools/move-fuse.js');
    const { StadiumApiError } = await import('../../src/core/stadium-client.js');
    let caught: unknown;
    try {
      await moveFuseTool.handler({ canonical_move_name: 'ember', real_skill_id: 'rs_missing' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(StadiumApiError);
    expect((caught as InstanceType<typeof StadiumApiError>).error_code).toBe('unknown_real_skill_id');
  });
});
