import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });

describe('vault.real-skill-register', () => {
  const vaultPath = join(tmpdir(), 'vault-real-skill-register-' + Date.now() + '-' + Math.random());

  beforeEach(() => {
    mkdirSync(join(vaultPath, 'wikis', 'alpha', 'moves', 'move-tdd-cycle'), { recursive: true });
    mkdirSync(join(vaultPath, '_index'), { recursive: true });
    writeFileSync(
      join(vaultPath, 'wikis', 'alpha', 'moves', 'move-tdd-cycle', 'SKILL.md'),
      `---\nid: move-tdd-cycle\ntype: move\ntitle: "TDD cycle"\nwiki: alpha\nstatus: active\ncreated: '2026-05-01'\nupdated: '2026-05-01'\nsummary: "Red-green-refactor"\ntags: [move]\n---\nWrite a failing test first.\n`
    );
    process.env.STADIUM_API_KEY = 'sk';
    process.env.STADIUM_BASE_URL = 'https://api.test';
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    delete process.env.STADIUM_API_KEY;
    delete process.env.STADIUM_BASE_URL;
  });

  it('registers real-skill and persists real_skill_id + combat block', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            real_skill_id: 'rs_tdd',
            modifier_function: { accuracy_mod: 0.1, power_mod: 0, effect_chance_mod: 0, level_scaling: 1 }
          }),
          { status: 200 }
        )
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const { realSkillRegisterTool } = await import('../../src/tools/real-skill-register.js');
    const out = await realSkillRegisterTool.handler(
      { skill_id: 'move-tdd-cycle' },
      { vaultPath, defaultWiki: 'alpha' }
    );

    expect(out.real_skill_id).toBe('rs_tdd');
    expect(out.modifier_function).toEqual({
      accuracy_mod: 0.1,
      power_mod: 0,
      effect_chance_mod: 0,
      level_scaling: 1
    });

    const after = readFileSync(
      join(vaultPath, 'wikis', 'alpha', 'moves', 'move-tdd-cycle', 'SKILL.md'),
      'utf8'
    );
    expect(after).toContain('real_skill_id: rs_tdd');
    expect(after).toContain('accuracy_mod: 0.1');
    // body preserved
    expect(after).toContain('Write a failing test first.');
  });

  it('sends the raw SKILL.md content as skill_md_content in the request body', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            real_skill_id: 'rs_x',
            modifier_function: { accuracy_mod: 0, power_mod: 0, effect_chance_mod: 0, level_scaling: 1 }
          }),
          { status: 200 }
        )
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const { realSkillRegisterTool } = await import('../../src/tools/real-skill-register.js');
    await realSkillRegisterTool.handler(
      { skill_id: 'move-tdd-cycle' },
      { vaultPath, defaultWiki: 'alpha' }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/real-skills/register');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.skill_id).toBe('move-tdd-cycle');
    expect(body.skill_md_content).toContain('Write a failing test first.');
    expect(body.skill_md_content).toContain('id: move-tdd-cycle');
  });

  it('surfaces server error_code via StadiumApiError (e.g., modifier_clamped)', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error_code: 'modifier_clamped', message: 'Modifier out of range' }),
          { status: 422 }
        )
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const { realSkillRegisterTool } = await import('../../src/tools/real-skill-register.js');
    const { StadiumApiError } = await import('../../src/core/stadium-client.js');

    let caught: unknown;
    try {
      await realSkillRegisterTool.handler(
        { skill_id: 'move-tdd-cycle' },
        { vaultPath, defaultWiki: 'alpha' }
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(StadiumApiError);
    const err = caught as InstanceType<typeof StadiumApiError>;
    expect(err.error_code).toBe('modifier_clamped');
  });
});
