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

export class StadiumTrainerNotFoundError extends Error {
  constructor(name: string, available: string[]) {
    super(
      `Stadium trainer "${name}" not found in ~/.vault/stadium.toml. ` +
      `Available: ${available.length ? available.join(', ') : '(none)'}.`
    );
    this.name = 'StadiumTrainerNotFoundError';
  }
}

export interface StadiumConfig {
  api_key: string;
  trainer_id?: string;
  base_url: string;
  /**
   * Platform-side trainer name. Comes from the selected `[trainer.<header>]` section's
   * explicit `name = "..."` field if present, else falls back to the section header itself.
   * Undefined when no section is selected (legacy single-trainer flat-key TOML).
   *
   * The TOML section header is a private/local alias (used by `STADIUM_TRAINER` and `active`);
   * `name` is the globally-shared identifier used in handles like `<account>:<name>`.
   */
  name?: string;
}

interface StadiumTomlShape {
  api_key?: string;
  trainer_id?: string;
  base_url?: string;
  active?: string;
  trainers?: Record<string, { api_key?: string; trainer_id?: string; base_url?: string; name?: string }>;
}

const DEFAULT_BASE_URL = 'https://stadium.app/api/v1';

export function resolveStadiumConfig(opts: { home?: string } = {}): StadiumConfig {
  // Precedence: explicit opts.home > STADIUM_HOME env > homedir().
  // STADIUM_HOME is testing/operations-friendly: tests point it at an isolated tmpdir
  // so the user's real `~/.vault/stadium.toml` doesn't bleed into unit tests.
  const home = opts.home ?? process.env.STADIUM_HOME ?? homedir();
  const tomlPath = join(home, '.vault', 'stadium.toml');
  const fromToml: StadiumTomlShape = existsSync(tomlPath)
    ? parseStadiumToml(readFileSync(tomlPath, 'utf8'))
    : {};

  const fromEnv: Partial<StadiumConfig> = {};
  if (process.env.STADIUM_API_KEY) fromEnv.api_key = process.env.STADIUM_API_KEY;
  if (process.env.STADIUM_TRAINER_ID) fromEnv.trainer_id = process.env.STADIUM_TRAINER_ID;
  if (process.env.STADIUM_BASE_URL) fromEnv.base_url = process.env.STADIUM_BASE_URL;

  // Determine active trainer name: STADIUM_TRAINER env > top-level `active` field.
  const trainerName = process.env.STADIUM_TRAINER || fromToml.active;

  let fromSection: { api_key?: string; trainer_id?: string; base_url?: string; name?: string } = {};
  let resolvedName: string | undefined;
  if (trainerName) {
    const trainers = fromToml.trainers ?? {};
    const section = trainers[trainerName];
    if (!section) {
      throw new StadiumTrainerNotFoundError(trainerName, Object.keys(trainers));
    }
    fromSection = section;
    // Explicit `name` field overrides the section header. Otherwise the section header
    // (the part after `trainer.`) IS the platform-side trainer name.
    resolvedName = section.name ?? trainerName;
  }

  const fromRoot: Partial<StadiumConfig> = {
    api_key: fromToml.api_key,
    trainer_id: fromToml.trainer_id,
    base_url: fromToml.base_url
  };

  // Precedence (low → high): env, root, section.
  // - section: most specific, wins when explicitly selected
  // - root: shared defaults (legacy single-trainer config)
  // - env: fallback for fields none of the above provide
  const merged: Partial<StadiumConfig> = {
    api_key: fromSection.api_key ?? fromRoot.api_key ?? fromEnv.api_key,
    trainer_id: fromSection.trainer_id ?? fromRoot.trainer_id ?? fromEnv.trainer_id,
    base_url: fromSection.base_url ?? fromRoot.base_url ?? fromEnv.base_url
  };

  if (!merged.api_key) throw new StadiumConfigMissingError();
  return {
    api_key: merged.api_key,
    trainer_id: merged.trainer_id,
    base_url: merged.base_url ?? DEFAULT_BASE_URL,
    name: resolvedName
  };
}

function parseStadiumToml(content: string): StadiumTomlShape {
  const out: StadiumTomlShape = {};
  let currentSection: string | null = null; // null = root, "trainer.<name>" = trainer section, other = unknown

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('[') && line.endsWith(']')) {
      currentSection = line.slice(1, -1).trim();
      continue;
    }

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

    if (currentSection === null) {
      // Root-level keys (back-compat single-trainer config + the multi-trainer `active` selector).
      if (key === 'api_key') out.api_key = value;
      else if (key === 'trainer_id') out.trainer_id = value;
      else if (key === 'base_url') out.base_url = value;
      else if (key === 'active') out.active = value;
    } else if (currentSection.startsWith('trainer.')) {
      const headerName = currentSection.slice('trainer.'.length);
      if (!headerName) continue; // malformed [trainer.] header
      if (!out.trainers) out.trainers = {};
      const t = out.trainers[headerName] ?? (out.trainers[headerName] = {});
      if (key === 'api_key') t.api_key = value;
      else if (key === 'trainer_id') t.trainer_id = value;
      else if (key === 'base_url') t.base_url = value;
      else if (key === 'name') t.name = value;
    }
    // Unknown sections (e.g. `[stadium]`) are silently ignored — keys inside are not routed.
  }

  return out;
}
