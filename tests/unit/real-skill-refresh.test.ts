import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });

describe('vault_real-skill-refresh', () => {
  const vaultPath = join(tmpdir(), 'vault-real-skill-refresh-' + Date.now() + '-' + Math.random());
  beforeEach(() => {
    mkdirSync(join(vaultPath, '_index'), { recursive: true });
    mkdirSync(join(vaultPath, 'wikis', 'alpha', 'moves', 'move-tdd-cycle'), { recursive: true });
    writeFileSync(join(vaultPath, 'wikis', 'alpha', 'moves', 'move-tdd-cycle', 'SKILL.md'),
      `---\nid: move-tdd-cycle\ntype: move\ntitle: "TDD"\nwiki: alpha\nstatus: active\ncreated: '2026-05-01'\nupdated: '2026-05-01'\nreal_skill_id: rs_tdd\ncombat:\n  accuracy_mod: 0.05\n  power_mod: 0\n  effect_chance_mod: 0\n  level_scaling: 1\nsummary: "TDD"\ntags: [move]\n---\nUpdated body.\n`);
    process.env.STADIUM_API_KEY = 'sk';
    process.env.STADIUM_BASE_URL = 'https://api.test';
  });
  afterEach(() => rmSync(vaultPath, { recursive: true, force: true }));

  it('refreshes modifier and overwrites local combat block', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      real_skill_id: 'rs_tdd', modifier_function: { accuracy_mod: 0.15, power_mod: 0.05, effect_chance_mod: 0, level_scaling: 1 }
    }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const { realSkillRefreshTool } = await import('../../src/tools/real-skill-refresh.js');
    await realSkillRefreshTool.handler({ skill_id: 'move-tdd-cycle' }, { vaultPath, defaultWiki: 'alpha' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/real-skills/rs_tdd/refresh');
    const after = readFileSync(join(vaultPath, 'wikis', 'alpha', 'moves', 'move-tdd-cycle', 'SKILL.md'), 'utf8');
    expect(after).toContain('accuracy_mod: 0.15');
  });

  it('throws when SKILL.md has no real_skill_id', async () => {
    writeFileSync(join(vaultPath, 'wikis', 'alpha', 'moves', 'move-tdd-cycle', 'SKILL.md'),
      `---\nid: move-tdd-cycle\ntype: move\ntitle: "TDD"\nwiki: alpha\nstatus: active\ncreated: '2026-05-01'\nupdated: '2026-05-01'\nsummary: "TDD"\ntags: [move]\n---\nNot registered yet.\n`);
    const { realSkillRefreshTool } = await import('../../src/tools/real-skill-refresh.js');
    await expect(
      realSkillRefreshTool.handler({ skill_id: 'move-tdd-cycle' }, { vaultPath, defaultWiki: 'alpha' })
    ).rejects.toThrow(/no real_skill_id/);
  });
});
