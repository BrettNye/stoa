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

  it('TOML wins over env vars when both provide the same key', async () => {
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

  it('skips comment lines and section headers in TOML', async () => {
    writeFileSync(join(tmpHome, '.vault', 'stadium.toml'),
      '# This is a comment\n[stadium]\napi_key = "sk_section"\n');
    const { resolveStadiumConfig } = await import('../../src/core/stadium-config.js');
    const cfg = resolveStadiumConfig({ home: tmpHome });
    expect(cfg.api_key).toBe('sk_section');
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
});
