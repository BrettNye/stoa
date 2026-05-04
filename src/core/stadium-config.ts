import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export class StadiumConfigMissingError extends Error {
  constructor() {
    super(
      'Stadium config not found. Create ~/.vault/stadium.toml with at least api_key, ' +
      'or set STADIUM_API_KEY (and optionally STADIUM_TRAINER_ID, STADIUM_BASE_URL).'
    );
    this.name = 'StadiumConfigMissingError';
  }
}

export interface StadiumConfig {
  api_key: string;
  trainer_id?: string;
  base_url: string;
}

const DEFAULT_BASE_URL = 'https://stadium.app/api/v1';

export function resolveStadiumConfig(opts: { home?: string } = {}): StadiumConfig {
  const home = opts.home ?? homedir();
  const tomlPath = join(home, '.vault', 'stadium.toml');
  const fromToml = existsSync(tomlPath) ? parseStadiumToml(readFileSync(tomlPath, 'utf8')) : {};
  const fromEnv: Partial<StadiumConfig> = {};
  if (process.env.STADIUM_API_KEY) fromEnv.api_key = process.env.STADIUM_API_KEY;
  if (process.env.STADIUM_TRAINER_ID) fromEnv.trainer_id = process.env.STADIUM_TRAINER_ID;
  if (process.env.STADIUM_BASE_URL) fromEnv.base_url = process.env.STADIUM_BASE_URL;
  const merged: Partial<StadiumConfig> = { ...fromEnv, ...fromToml };
  if (!merged.api_key) throw new StadiumConfigMissingError();
  return {
    api_key: merged.api_key,
    trainer_id: merged.trainer_id,
    base_url: merged.base_url ?? DEFAULT_BASE_URL
  };
}

function parseStadiumToml(content: string): Partial<StadiumConfig> {
  const out: Partial<StadiumConfig> = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('[')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.startsWith('"') || value.startsWith("'")) {
      const q = value[0];
      const close = value.indexOf(q, 1);
      value = close > 0 ? value.slice(1, close) : value.slice(1);
    } else {
      const commentIdx = value.indexOf(' #');
      if (commentIdx >= 0) value = value.slice(0, commentIdx).trim();
    }
    if (key === 'api_key') out.api_key = value;
    else if (key === 'trainer_id') out.trainer_id = value;
    else if (key === 'base_url') out.base_url = value;
  }
  return out;
}
