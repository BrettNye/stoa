import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });

describe('vault.profile-register', () => {
  const vaultPath = join(tmpdir(), 'vault-profile-register-' + Date.now() + '-' + Math.random());

  beforeEach(() => {
    mkdirSync(join(vaultPath, 'wikis', 'alpha', 'profiles'), { recursive: true });
    mkdirSync(join(vaultPath, '_index'), { recursive: true });
    writeFileSync(
      join(vaultPath, 'wikis', 'alpha', 'profiles', 'profile-charmander.md'),
      `---\nid: profile-charmander\ntype: profile\ntitle: "Charmander"\nwiki: alpha\nstatus: active\ncreated: '2026-05-01'\nupdated: '2026-05-01'\npokemon: charmander\nevolution_stage: basic\nsummary: "Fire starter"\ntags: [profile]\n---\nBody.\n`
    );
    process.env.STADIUM_API_KEY = 'sk';
    process.env.STADIUM_BASE_URL = 'https://api.test';
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    delete process.env.STADIUM_API_KEY;
    delete process.env.STADIUM_BASE_URL;
  });

  it('registers profile and persists platform_profile_id + platform_stats', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(
        JSON.stringify({ profile_id: 'pf_1', stats: { hp: 39, atk: 52, def: 43, spd: 65, types: ['fire'] } }),
        { status: 200 }
      ))
    );
    vi.stubGlobal('fetch', fetchMock);
    const { profileRegisterTool } = await import('../../src/tools/profile-register.js');
    const out = await profileRegisterTool.handler(
      { profile_id: 'profile-charmander' },
      { vaultPath, defaultWiki: 'alpha' }
    );

    expect(out.profile_id).toBe('pf_1');
    expect(out.stats).toEqual({ hp: 39, atk: 52, def: 43, spd: 65, types: ['fire'] });

    const after = readFileSync(
      join(vaultPath, 'wikis', 'alpha', 'profiles', 'profile-charmander.md'),
      'utf8'
    );
    expect(after).toContain('platform_profile_id: pf_1');
    expect(after).toContain('platform_stats:');
    // Body preserved
    expect(after).toContain('Body.');
  });

  it('POSTs to /profiles/register with species_name from `pokemon` field', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(
        JSON.stringify({ profile_id: 'pf_2', stats: { hp: 39, atk: 52, def: 43, spd: 65, types: ['fire'] } }),
        { status: 200 }
      ))
    );
    vi.stubGlobal('fetch', fetchMock);
    const { profileRegisterTool } = await import('../../src/tools/profile-register.js');
    await profileRegisterTool.handler(
      { profile_id: 'profile-charmander' },
      { vaultPath, defaultWiki: 'alpha' }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/profiles/register');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      species_name: 'charmander',
      evolution_stage: 'basic',
      vault_profile_id: 'profile-charmander'
    });
  });

  it('falls back to species_name field when pokemon field is absent', async () => {
    writeFileSync(
      join(vaultPath, 'wikis', 'alpha', 'profiles', 'profile-bulbasaur.md'),
      `---\nid: profile-bulbasaur\ntype: profile\ntitle: "Bulbasaur"\nwiki: alpha\nstatus: active\ncreated: '2026-05-01'\nupdated: '2026-05-01'\nspecies_name: bulbasaur\nevolution_stage: basic\nsummary: "Grass starter"\ntags: [profile]\n---\nBody.\n`
    );
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(
        JSON.stringify({ profile_id: 'pf_3', stats: { hp: 45, atk: 49, def: 49, spd: 45, types: ['grass', 'poison'] } }),
        { status: 200 }
      ))
    );
    vi.stubGlobal('fetch', fetchMock);
    const { profileRegisterTool } = await import('../../src/tools/profile-register.js');
    await profileRegisterTool.handler(
      { profile_id: 'profile-bulbasaur' },
      { vaultPath, defaultWiki: 'alpha' }
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.species_name).toBe('bulbasaur');
  });

  it('throws when neither pokemon nor species_name field is present', async () => {
    writeFileSync(
      join(vaultPath, 'wikis', 'alpha', 'profiles', 'profile-mystery.md'),
      `---\nid: profile-mystery\ntype: profile\ntitle: "Mystery"\nwiki: alpha\nstatus: active\ncreated: '2026-05-01'\nupdated: '2026-05-01'\nevolution_stage: basic\nsummary: "?"\ntags: [profile]\n---\nBody.\n`
    );
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { profileRegisterTool } = await import('../../src/tools/profile-register.js');
    await expect(
      profileRegisterTool.handler(
        { profile_id: 'profile-mystery' },
        { vaultPath, defaultWiki: 'alpha' }
      )
    ).rejects.toThrow(/missing 'pokemon' field/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces server error_code via StadiumApiError', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(
        JSON.stringify({ error_code: 'pokeapi_unknown_species', message: 'unknown species' }),
        { status: 422 }
      ))
    );
    vi.stubGlobal('fetch', fetchMock);
    const { profileRegisterTool } = await import('../../src/tools/profile-register.js');
    const { StadiumApiError } = await import('../../src/core/stadium-client.js');
    let caught: unknown;
    try {
      await profileRegisterTool.handler(
        { profile_id: 'profile-charmander' },
        { vaultPath, defaultWiki: 'alpha' }
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(StadiumApiError);
    expect((caught as InstanceType<typeof StadiumApiError>).error_code).toBe('pokeapi_unknown_species');
  });
});
