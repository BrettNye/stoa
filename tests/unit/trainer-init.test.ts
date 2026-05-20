import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });

describe('vault_trainer-init', () => {
  const vaultPath = join(tmpdir(), 'vault-trainer-init-test-' + Date.now() + '-' + Math.random());
  beforeEach(() => {
    mkdirSync(join(vaultPath, 'wikis', '_agents'), { recursive: true });
    process.env.STADIUM_API_KEY = 'sk_test';
    process.env.STADIUM_TRAINER_ID = 'trn_xyz';
    process.env.STADIUM_BASE_URL = 'https://api.test';
  });
  afterEach(() => rmSync(vaultPath, { recursive: true, force: true }));

  it('writes trainer-<slug>.md with frontmatter and validates connectivity', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ status: 'ok' }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const { trainerInitTool } = await import('../../src/tools/trainer-init.js');
    const out = await trainerInitTool.handler({ name: 'Brett', strategy: 'Lead Fire.' }, { vaultPath });
    expect(out.id).toBe('trainer-brett');
    const path = join(vaultPath, 'wikis', '_agents', 'trainers', 'trainer-brett.md');
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, 'utf8');
    expect(content).toContain('id: trainer-brett');
    expect(content).toContain('trainer_id: trn_xyz');
    expect(content).toContain('Lead Fire.');
    expect(fetchMock).toHaveBeenCalledWith('https://api.test/health', expect.any(Object));
  });

  it('writes default skeleton body when strategy is absent', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ status: 'ok' }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const { trainerInitTool } = await import('../../src/tools/trainer-init.js');
    await trainerInitTool.handler({ name: 'Brett' }, { vaultPath });
    const path = join(vaultPath, 'wikis', '_agents', 'trainers', 'trainer-brett.md');
    const content = readFileSync(path, 'utf8');
    expect(content).toContain('## Drafting');
    expect(content).toContain('## Lead choice');
    expect(content).not.toContain('Lead Fire.');
  });
});
