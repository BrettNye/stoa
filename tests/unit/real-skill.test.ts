import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });

// -----------------------------------------------------------------------
// vault_real-skill (consolidated: mode=register | mode=refresh)
// -----------------------------------------------------------------------

const SKILL_MD_NO_ID = `---\nid: move-tdd-cycle\ntype: move\ntitle: "TDD cycle"\nwiki: alpha\nstatus: active\ncreated: '2026-05-01'\nupdated: '2026-05-01'\nsummary: "Red-green-refactor"\ntags: [move]\n---\nWrite a failing test first.\n`;

const SKILL_MD_WITH_ID = `---\nid: move-tdd-cycle\ntype: move\ntitle: "TDD"\nwiki: alpha\nstatus: active\ncreated: '2026-05-01'\nupdated: '2026-05-01'\nreal_skill_id: rs_tdd\ncombat:\n  accuracy_mod: 0.05\n  power_mod: 0\n  effect_chance_mod: 0\n  level_scaling: 1\nsummary: "TDD"\ntags: [move]\n---\nUpdated body.\n`;

function makeVault(suffix: string) {
  const vaultPath = join(tmpdir(), `vault-real-skill-${suffix}-${Date.now()}-${Math.random()}`);
  mkdirSync(join(vaultPath, '_index'), { recursive: true });
  mkdirSync(join(vaultPath, 'wikis', 'alpha', 'moves', 'move-tdd-cycle'), { recursive: true });
  return vaultPath;
}

function writeSkillMd(vaultPath: string, content: string) {
  writeFileSync(join(vaultPath, 'wikis', 'alpha', 'moves', 'move-tdd-cycle', 'SKILL.md'), content);
}

function readSkillMd(vaultPath: string) {
  return readFileSync(join(vaultPath, 'wikis', 'alpha', 'moves', 'move-tdd-cycle', 'SKILL.md'), 'utf8');
}

// -----------------------------------------------------------------------
// mode: register
// -----------------------------------------------------------------------
describe('vault_real-skill — mode: register', () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = makeVault('register');
    writeSkillMd(vaultPath, SKILL_MD_NO_ID);
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

    const { realSkillTool } = await import('../../src/tools/real-skill.js');
    const out = await realSkillTool.handler(
      { mode: 'register', skill_id: 'move-tdd-cycle' },
      { vaultPath, defaultWiki: 'alpha' }
    );

    expect(out.real_skill_id).toBe('rs_tdd');
    expect(out.modifier_function).toEqual({
      accuracy_mod: 0.1,
      power_mod: 0,
      effect_chance_mod: 0,
      level_scaling: 1
    });

    const after = readSkillMd(vaultPath);
    expect(after).toContain('real_skill_id: rs_tdd');
    expect(after).toContain('accuracy_mod: 0.1');
    expect(after).toContain('Write a failing test first.');
  });

  it('sends raw SKILL.md content as skill_md_content in the request body', async () => {
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

    const { realSkillTool } = await import('../../src/tools/real-skill.js');
    await realSkillTool.handler(
      { mode: 'register', skill_id: 'move-tdd-cycle' },
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

    const { realSkillTool } = await import('../../src/tools/real-skill.js');
    const { StadiumApiError } = await import('../../src/core/stadium-client.js');

    let caught: unknown;
    try {
      await realSkillTool.handler(
        { mode: 'register', skill_id: 'move-tdd-cycle' },
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

// -----------------------------------------------------------------------
// mode: refresh
// -----------------------------------------------------------------------
describe('vault_real-skill — mode: refresh', () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = makeVault('refresh');
    writeSkillMd(vaultPath, SKILL_MD_WITH_ID);
    process.env.STADIUM_API_KEY = 'sk';
    process.env.STADIUM_BASE_URL = 'https://api.test';
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    delete process.env.STADIUM_API_KEY;
    delete process.env.STADIUM_BASE_URL;
  });

  it('refreshes modifier and overwrites local combat block', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            real_skill_id: 'rs_tdd',
            modifier_function: { accuracy_mod: 0.15, power_mod: 0.05, effect_chance_mod: 0, level_scaling: 1 }
          }),
          { status: 200 }
        )
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const { realSkillTool } = await import('../../src/tools/real-skill.js');
    await realSkillTool.handler(
      { mode: 'refresh', skill_id: 'move-tdd-cycle' },
      { vaultPath, defaultWiki: 'alpha' }
    );

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/real-skills/rs_tdd/refresh');
    const after = readSkillMd(vaultPath);
    expect(after).toContain('accuracy_mod: 0.15');
  });

  it('throws "register first" when SKILL.md has no real_skill_id', async () => {
    writeSkillMd(vaultPath, SKILL_MD_NO_ID);

    const { realSkillTool } = await import('../../src/tools/real-skill.js');
    await expect(
      realSkillTool.handler(
        { mode: 'refresh', skill_id: 'move-tdd-cycle' },
        { vaultPath, defaultWiki: 'alpha' }
      )
    ).rejects.toThrow(/register first/);
  });
});

// -----------------------------------------------------------------------
// schema and scope
// -----------------------------------------------------------------------
describe('vault_real-skill — schema and scope', () => {
  it('has name vault_real-skill', async () => {
    const { realSkillTool } = await import('../../src/tools/real-skill.js');
    expect(realSkillTool.name).toBe('vault_real-skill');
  });

  it('has scope axis "stadium"', async () => {
    const { realSkillTool } = await import('../../src/tools/real-skill.js');
    expect(realSkillTool.scope.axis({})).toBe('stadium');
  });

  it('has adminOnly: () => true', async () => {
    const { realSkillTool } = await import('../../src/tools/real-skill.js');
    expect(realSkillTool.scope.adminOnly!({})).toBe(true);
  });

  it('inputSchema accepts mode=register', async () => {
    const { realSkillTool } = await import('../../src/tools/real-skill.js');
    const result = (realSkillTool.inputSchema as import('zod').ZodTypeAny).safeParse({
      mode: 'register',
      skill_id: 'move-tdd-cycle',
    });
    expect(result.success).toBe(true);
  });

  it('inputSchema accepts mode=refresh', async () => {
    const { realSkillTool } = await import('../../src/tools/real-skill.js');
    const result = (realSkillTool.inputSchema as import('zod').ZodTypeAny).safeParse({
      mode: 'refresh',
      skill_id: 'move-tdd-cycle',
    });
    expect(result.success).toBe(true);
  });

  it('inputSchema rejects skill_id not starting with move-', async () => {
    const { realSkillTool } = await import('../../src/tools/real-skill.js');
    const result = (realSkillTool.inputSchema as import('zod').ZodTypeAny).safeParse({
      mode: 'register',
      skill_id: 'skill-xyz',
    });
    expect(result.success).toBe(false);
  });
});
