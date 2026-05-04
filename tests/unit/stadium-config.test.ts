import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

beforeEach(() => vi.resetModules());

describe('stadium-config', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = join(tmpdir(), 'vault-stadium-config-test-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  });

  beforeEach(() => {
    mkdirSync(join(tmpHome, '.vault'), { recursive: true });
    delete process.env.STADIUM_API_KEY;
    delete process.env.STADIUM_TRAINER_ID;
    delete process.env.STADIUM_BASE_URL;
    delete process.env.STADIUM_TRAINER;
  });
  afterEach(() => rmSync(tmpHome, { recursive: true, force: true }));

  it('reads api_key, trainer_id, base_url from TOML', async () => {
    writeFileSync(join(tmpHome, '.vault', 'stadium.toml'),
      'api_key = "sk_live_abc"\ntrainer_id = "trn_123"\nbase_url = "https://stadium.app/api/v1"\n');
    const { resolveStadiumConfig } = await import('../../src/core/stadium-config.js');
    expect(resolveStadiumConfig({ home: tmpHome })).toEqual({
      api_key: 'sk_live_abc', trainer_id: 'trn_123', base_url: 'https://stadium.app/api/v1'
    });
  });

  it('falls back to env vars when TOML is absent', async () => {
    process.env.STADIUM_API_KEY = 'sk_env_key';
    process.env.STADIUM_TRAINER_ID = 'trn_env';
    process.env.STADIUM_BASE_URL = 'https://custom.example.com';
    const { resolveStadiumConfig } = await import('../../src/core/stadium-config.js');
    // Use a home dir with no stadium.toml (tmpHome/.vault exists but no toml file)
    expect(resolveStadiumConfig({ home: tmpHome })).toEqual({
      api_key: 'sk_env_key', trainer_id: 'trn_env', base_url: 'https://custom.example.com'
    });
  });

  it('uses default base_url when neither TOML nor env provides it', async () => {
    process.env.STADIUM_API_KEY = 'sk_env_only';
    const { resolveStadiumConfig } = await import('../../src/core/stadium-config.js');
    const cfg = resolveStadiumConfig({ home: tmpHome });
    expect(cfg.base_url).toBe('https://stadium.app/api/v1');
  });

  it('TOML root wins over env vars when both provide the same key', async () => {
    writeFileSync(join(tmpHome, '.vault', 'stadium.toml'),
      'api_key = "sk_toml"\nbase_url = "https://toml.example.com"\n');
    process.env.STADIUM_API_KEY = 'sk_env_should_lose';
    process.env.STADIUM_BASE_URL = 'https://env.example.com';
    const { resolveStadiumConfig } = await import('../../src/core/stadium-config.js');
    const cfg = resolveStadiumConfig({ home: tmpHome });
    expect(cfg.api_key).toBe('sk_toml');
    expect(cfg.base_url).toBe('https://toml.example.com');
  });

  it('throws StadiumConfigMissingError when neither source provides api_key', async () => {
    const { resolveStadiumConfig, StadiumConfigMissingError } = await import('../../src/core/stadium-config.js');
    expect(() => resolveStadiumConfig({ home: tmpHome })).toThrow(StadiumConfigMissingError);
  });

  it('strips surrounding double quotes from TOML values', async () => {
    writeFileSync(join(tmpHome, '.vault', 'stadium.toml'),
      'api_key = "quoted_value"\n');
    const { resolveStadiumConfig } = await import('../../src/core/stadium-config.js');
    const cfg = resolveStadiumConfig({ home: tmpHome });
    expect(cfg.api_key).toBe('quoted_value');
  });

  it('strips surrounding single quotes from TOML values', async () => {
    writeFileSync(join(tmpHome, '.vault', 'stadium.toml'),
      "api_key = 'single_quoted'\n");
    const { resolveStadiumConfig } = await import('../../src/core/stadium-config.js');
    const cfg = resolveStadiumConfig({ home: tmpHome });
    expect(cfg.api_key).toBe('single_quoted');
  });

  it('ignores keys inside unknown section headers', async () => {
    // Pre-multi-trainer behavior treated `[anything]` as a no-op skip and continued
    // routing keys to root. Now sections matter: only `[trainer.<name>]` routes.
    // Unknown sections (e.g. `[stadium]`) silently drop their keys.
    writeFileSync(join(tmpHome, '.vault', 'stadium.toml'),
      'api_key = "sk_root"\n[stadium]\napi_key = "sk_section_ignored"\n');
    const { resolveStadiumConfig } = await import('../../src/core/stadium-config.js');
    const cfg = resolveStadiumConfig({ home: tmpHome });
    expect(cfg.api_key).toBe('sk_root');
  });

  it('trainer_id is optional and absent when not provided', async () => {
    writeFileSync(join(tmpHome, '.vault', 'stadium.toml'),
      'api_key = "sk_no_trainer"\n');
    const { resolveStadiumConfig } = await import('../../src/core/stadium-config.js');
    const cfg = resolveStadiumConfig({ home: tmpHome });
    expect(cfg.trainer_id).toBeUndefined();
  });

  it('strips inline comment from quoted TOML value', async () => {
    writeFileSync(join(tmpHome, '.vault', 'stadium.toml'),
      'api_key = "sk_abc" # comment\n');
    const { resolveStadiumConfig } = await import('../../src/core/stadium-config.js');
    const cfg = resolveStadiumConfig({ home: tmpHome });
    expect(cfg.api_key).toBe('sk_abc');
  });

  it('strips inline comment from bare TOML value', async () => {
    writeFileSync(join(tmpHome, '.vault', 'stadium.toml'),
      'api_key = sk_abc # comment\n');
    const { resolveStadiumConfig } = await import('../../src/core/stadium-config.js');
    const cfg = resolveStadiumConfig({ home: tmpHome });
    expect(cfg.api_key).toBe('sk_abc');
  });

  // Multi-trainer TOML

  it('selects trainer via top-level `active` field', async () => {
    writeFileSync(join(tmpHome, '.vault', 'stadium.toml'),
      `active = "main"

[trainer.main]
api_key = "sk_main"
trainer_id = "trn_main"
base_url = "https://main.example.com"

[trainer.test_b]
api_key = "sk_test_b"
trainer_id = "trn_test_b"
`);
    const { resolveStadiumConfig } = await import('../../src/core/stadium-config.js');
    expect(resolveStadiumConfig({ home: tmpHome })).toEqual({
      api_key: 'sk_main', trainer_id: 'trn_main', base_url: 'https://main.example.com', name: 'main'
    });
  });

  it('STADIUM_TRAINER env var overrides the `active` field', async () => {
    writeFileSync(join(tmpHome, '.vault', 'stadium.toml'),
      `active = "main"

[trainer.main]
api_key = "sk_main"
trainer_id = "trn_main"

[trainer.test_b]
api_key = "sk_test_b"
trainer_id = "trn_test_b"
base_url = "https://b.example.com"
`);
    process.env.STADIUM_TRAINER = 'test_b';
    const { resolveStadiumConfig } = await import('../../src/core/stadium-config.js');
    expect(resolveStadiumConfig({ home: tmpHome })).toEqual({
      api_key: 'sk_test_b', trainer_id: 'trn_test_b', base_url: 'https://b.example.com', name: 'test_b'
    });
  });

  it('section keys fall back to root keys when missing', async () => {
    // base_url is shared at root; only api_key/trainer_id are per-trainer.
    writeFileSync(join(tmpHome, '.vault', 'stadium.toml'),
      `base_url = "https://shared.example.com"

[trainer.main]
api_key = "sk_main"
trainer_id = "trn_main"
`);
    process.env.STADIUM_TRAINER = 'main';
    const { resolveStadiumConfig } = await import('../../src/core/stadium-config.js');
    const cfg = resolveStadiumConfig({ home: tmpHome });
    expect(cfg.api_key).toBe('sk_main');
    expect(cfg.base_url).toBe('https://shared.example.com');
  });

  it('throws StadiumTrainerNotFoundError when STADIUM_TRAINER points to missing section', async () => {
    writeFileSync(join(tmpHome, '.vault', 'stadium.toml'),
      `[trainer.main]
api_key = "sk_main"
`);
    process.env.STADIUM_TRAINER = 'nonexistent';
    const { resolveStadiumConfig, StadiumTrainerNotFoundError } = await import('../../src/core/stadium-config.js');
    expect(() => resolveStadiumConfig({ home: tmpHome })).toThrow(StadiumTrainerNotFoundError);
    try {
      resolveStadiumConfig({ home: tmpHome });
    } catch (e: unknown) {
      expect((e as Error).message).toContain('nonexistent');
      expect((e as Error).message).toContain('main');
    }
  });

  it('section keys win over env vars when section is selected', async () => {
    writeFileSync(join(tmpHome, '.vault', 'stadium.toml'),
      `[trainer.main]
api_key = "sk_section"
`);
    process.env.STADIUM_TRAINER = 'main';
    process.env.STADIUM_API_KEY = 'sk_env_should_lose';
    const { resolveStadiumConfig } = await import('../../src/core/stadium-config.js');
    const cfg = resolveStadiumConfig({ home: tmpHome });
    expect(cfg.api_key).toBe('sk_section');
  });

  it('env fills field when neither section nor root provides it', async () => {
    writeFileSync(join(tmpHome, '.vault', 'stadium.toml'),
      `[trainer.main]
api_key = "sk_main"
`);
    process.env.STADIUM_TRAINER = 'main';
    process.env.STADIUM_BASE_URL = 'https://from.env.example.com';
    const { resolveStadiumConfig } = await import('../../src/core/stadium-config.js');
    const cfg = resolveStadiumConfig({ home: tmpHome });
    expect(cfg.base_url).toBe('https://from.env.example.com');
  });

  it('section header is the default platform-side name', async () => {
    writeFileSync(join(tmpHome, '.vault', 'stadium.toml'),
      `[trainer.main]
api_key = "sk_main"
`);
    process.env.STADIUM_TRAINER = 'main';
    const { resolveStadiumConfig } = await import('../../src/core/stadium-config.js');
    const cfg = resolveStadiumConfig({ home: tmpHome });
    expect(cfg.name).toBe('main');
  });

  it('explicit `name` field overrides section header for platform-side name', async () => {
    // Section header "tdd" is a private alias used by STADIUM_TRAINER and `active`.
    // Platform sees the trainer as "b-tdd-aggressive".
    writeFileSync(join(tmpHome, '.vault', 'stadium.toml'),
      `[trainer.tdd]
name = "b-tdd-aggressive"
api_key = "sk_tdd"
`);
    process.env.STADIUM_TRAINER = 'tdd';
    const { resolveStadiumConfig } = await import('../../src/core/stadium-config.js');
    const cfg = resolveStadiumConfig({ home: tmpHome });
    expect(cfg.name).toBe('b-tdd-aggressive');
    expect(cfg.api_key).toBe('sk_tdd');
  });

  it('legacy flat-key TOML has no `name` (no section selected)', async () => {
    writeFileSync(join(tmpHome, '.vault', 'stadium.toml'),
      'api_key = "sk_legacy"\n');
    const { resolveStadiumConfig } = await import('../../src/core/stadium-config.js');
    const cfg = resolveStadiumConfig({ home: tmpHome });
    expect(cfg.name).toBeUndefined();
  });

  it('STADIUM_HOME env var overrides homedir() when opts.home is absent', async () => {
    // Write a TOML at the STADIUM_HOME-pointed dir, then call without opts.home.
    writeFileSync(join(tmpHome, '.vault', 'stadium.toml'),
      'api_key = "sk_from_stadium_home"\n');
    const origStadiumHome = process.env.STADIUM_HOME;
    process.env.STADIUM_HOME = tmpHome;
    try {
      const { resolveStadiumConfig } = await import('../../src/core/stadium-config.js');
      const cfg = resolveStadiumConfig(); // no opts — falls through to STADIUM_HOME
      expect(cfg.api_key).toBe('sk_from_stadium_home');
    } finally {
      if (origStadiumHome === undefined) delete process.env.STADIUM_HOME;
      else process.env.STADIUM_HOME = origStadiumHome;
    }
  });
});
