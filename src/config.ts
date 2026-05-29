import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import matter from "gray-matter";
import { z } from "zod";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface VaultConfig {
  vaultPath: string;
  mcpMode: boolean;
  defaultWiki?: string;
  // v1.6 Phase 2 T3-6 — symmetric to defaultWiki. Captured from
  // `--default-family=<name>` and threaded through buildCtx into ctx.defaultFamily,
  // where `core/family.resolveFamily` consults it.
  defaultFamily?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Claims config (Plan 1 — task-claim-config-defaults)
//
// Per spec §6.2 (wikis/_meta/specs/2026-05-02-vault-mcp-claims-design.md), a
// vault may tune the claims subsystem via a top-level `claims:` block in its
// vault config file. All keys are optional; omitted keys fall back to the
// spec's canonical defaults. Keep the default literals here in sync with §6.2.
// ─────────────────────────────────────────────────────────────────────────

export const ClaimsConfigSchema = z
  .object({
    half_life_days: z.number().positive().default(75),
    effective_floor: z.number().min(0).max(1).default(0.1),
    render_min_confidence: z.number().min(0).max(1).default(0.4),
    render_default_limit: z.number().int().positive().default(10),
    staleness_warn_days: z.number().int().positive().default(30),
    evolution_thresholds: z
      .object({
        stage1: z.number().int().positive().default(10),
        stage2: z.number().int().positive().default(25),
      })
      .default({}),
    specialty_min_cluster: z.number().int().positive().default(5),
  })
  .default({});

export type ClaimsConfig = z.infer<typeof ClaimsConfigSchema>;

/**
 * Resolve the effective claims config from a raw vault-config object.
 *
 * - `null`/`undefined`/non-object → treated as empty.
 * - Missing or empty `claims` field → all spec §6.2 defaults.
 * - Partial overrides merge with defaults at every level.
 * - Schema violations (negative half-life, non-integer threshold, out-of-range
 *   effective_floor, etc.) throw a ZodError; callers may catch and surface.
 */
export function getClaimsConfig(rawConfig: unknown): ClaimsConfig {
  const top = z
    .object({ claims: ClaimsConfigSchema })
    .parse(typeof rawConfig === "object" && rawConfig !== null ? rawConfig : {});
  return top.claims;
}

// ─────────────────────────────────────────────────────────────────────────
// Curation config (vault_curate — task-config)
//
// Per spec §4.5 (wikis/_meta/specs/2026-05-29-vault-curate-status-curation.md),
// a vault may tune the autonomous curation subsystem via a top-level `curation:`
// block in `.stoa/config.json`. All keys are optional; omitted keys fall back
// to the spec's canonical defaults. Keep the default literals here in sync
// with §4.5. Mirrors the ClaimsConfigSchema convention exactly.
// ─────────────────────────────────────────────────────────────────────────

export const CurationConfigSchema = z
  .object({
    archive_stale_days: z.number().int().positive().default(60),
    promote_active_recent_days: z.number().int().positive().default(14),
    confidence_floor: z.enum(["high", "medium", "low"]).default("medium"),
    auto_archive_human: z.boolean().default(false),
    auto_commit: z.boolean().default(true),
  })
  .default({});

export type CurationConfig = z.infer<typeof CurationConfigSchema>;

/**
 * Resolve the effective curation config from a raw vault-config object.
 *
 * - `null`/`undefined`/non-object → treated as empty.
 * - Missing or empty `curation` field → all spec §4.5 defaults.
 * - Partial overrides merge with defaults at every level.
 * - Schema violations (negative days, invalid confidence_floor, etc.) throw a
 *   ZodError; callers may catch and surface.
 */
export function getCurationConfig(rawConfig: unknown): CurationConfig {
  const top = z
    .object({ curation: CurationConfigSchema })
    .parse(typeof rawConfig === "object" && rawConfig !== null ? rawConfig : {});
  return top.curation;
}

// ─────────────────────────────────────────────────────────────────────────
// Source-type weights (T5 of the specialist-agent-substrate DAG; spec
// `wikis/_meta/specs/2026-05-19-specialist-agent-substrate-design.md` §5.4)
//
// Per-source-type weights applied during `vault.evolve-profile`'s claim-
// cluster math (see `core/evolution-claims.ts`). The weight is multiplied
// into each claim's `effective_confidence` when aggregating per-cluster
// totals. Defaults baked here; an optional `yaml source_type_weights` fence
// in `wikis/_agents/CLAUDE.md` overrides any subset.
//
// Weighting affects specialty-cluster identification and rationale ONLY —
// `vault.agent-memory` ranking and the legacy task-count eligibility gate
// are both unchanged.
// ─────────────────────────────────────────────────────────────────────────

export interface SourceTypeWeights {
  lived: number;
  curricular: number;
  retro: number;
}

export const DEFAULT_SOURCE_TYPE_WEIGHTS: SourceTypeWeights = {
  lived: 1.0,
  curricular: 0.5,
  retro: 0.7,
};

export class SourceTypeWeightsBlockError extends Error {
  public readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "SourceTypeWeightsBlockError";
    if (cause !== undefined) this.cause = cause;
  }
}

const sourceTypeWeightsSchema = z
  .object({
    lived: z.number().nonnegative().optional(),
    curricular: z.number().nonnegative().optional(),
    retro: z.number().nonnegative().optional(),
  })
  .partial();

// Match the first fenced block whose info string is exactly
// `yaml source_type_weights`, optionally followed by whitespace + further
// tokens. Body is non-greedy. Mirrors the `evolution_thresholds` fence
// regex in `core/thresholds.ts`.
const FENCE_RE = /^```yaml source_type_weights(?:[ \t][^\n]*)?\n([\s\S]*?)\n```/m;

/**
 * Read the optional `yaml source_type_weights` fence from
 * `wikis/_agents/CLAUDE.md` and return the effective weights. Missing file
 * or missing fence → returns `DEFAULT_SOURCE_TYPE_WEIGHTS`. Partial overrides
 * merge with defaults per key. Malformed YAML or schema violation throws
 * `SourceTypeWeightsBlockError` — callers may catch and fall back to
 * defaults (mirrors `readThresholds`'s defensive pattern).
 */
export function readSourceTypeWeights(vaultPath: string): SourceTypeWeights {
  const claudeMdPath = join(vaultPath, "wikis", "_agents", "CLAUDE.md");

  let raw: string;
  try {
    raw = readFileSync(claudeMdPath, "utf8");
  } catch (err: any) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
      return { ...DEFAULT_SOURCE_TYPE_WEIGHTS };
    }
    throw err;
  }

  const match = raw.match(FENCE_RE);
  if (!match) return { ...DEFAULT_SOURCE_TYPE_WEIGHTS };

  const body = match[1];

  let parsed: unknown;
  try {
    // Wrap the body in frontmatter delimiters; pass `{}` to defeat
    // gray-matter's content-keyed cache (same rationale as the
    // `readThresholds` parser in `core/thresholds.ts`).
    const wrapped = `---\n${body}\n---\n`;
    const result = matter(wrapped, {});
    parsed = result.data;
  } catch (err) {
    throw new SourceTypeWeightsBlockError(
      `failed to parse YAML in 'yaml source_type_weights' fence in wikis/_agents/CLAUDE.md`,
      err,
    );
  }

  const validated = sourceTypeWeightsSchema.safeParse(parsed);
  if (!validated.success) {
    const msgs = validated.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new SourceTypeWeightsBlockError(
      `'yaml source_type_weights' fence in wikis/_agents/CLAUDE.md failed schema validation: ${msgs}`,
      validated.error,
    );
  }

  return {
    lived: validated.data.lived ?? DEFAULT_SOURCE_TYPE_WEIGHTS.lived,
    curricular: validated.data.curricular ?? DEFAULT_SOURCE_TYPE_WEIGHTS.curricular,
    retro: validated.data.retro ?? DEFAULT_SOURCE_TYPE_WEIGHTS.retro,
  };
}

/**
 * Resolve weights with graceful fallback to defaults on `SourceTypeWeightsBlockError`.
 * Use this from the evolve-profile orchestrator path; lint surfaces the block error
 * separately (mirrors the `readThresholds` / `ThresholdBlockError` pattern).
 */
export function resolveSourceTypeWeights(vaultPath: string): SourceTypeWeights {
  try {
    return readSourceTypeWeights(vaultPath);
  } catch (err) {
    if (err instanceof SourceTypeWeightsBlockError) {
      return { ...DEFAULT_SOURCE_TYPE_WEIGHTS };
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Vault-local Stoa server config (.stoa/config.json)
//
// Per spec §9 of docs/superpowers/specs/2026-05-21-stoa-server-mode-design.md.
// Missing file → all defaults. Malformed JSON → all defaults (no throw).
// ─────────────────────────────────────────────────────────────────────────

export interface VaultStoaConfig {
  theme: "pokemon" | "plain";
  identity: { default_agent_id?: string };
  auth: { signing_secret_env: string; issuer_hint?: string };
  bind: string;
}

const DEFAULT_STOA_CONFIG: VaultStoaConfig = {
  theme: "pokemon",
  identity: {},
  auth: { signing_secret_env: "STOA_TOKEN_SIGNING_SECRET" },
  bind: "127.0.0.1:8443",
};

export function loadVaultStoaConfig(vaultPath: string): VaultStoaConfig {
  const path = join(vaultPath, ".stoa", "config.json");
  if (!existsSync(path)) return { ...DEFAULT_STOA_CONFIG, identity: { ...DEFAULT_STOA_CONFIG.identity }, auth: { ...DEFAULT_STOA_CONFIG.auth } };
  try {
    const file = JSON.parse(readFileSync(path, "utf8"));
    return {
      theme: file.theme ?? DEFAULT_STOA_CONFIG.theme,
      identity: { ...DEFAULT_STOA_CONFIG.identity, ...file.identity },
      auth: { ...DEFAULT_STOA_CONFIG.auth, ...file.auth },
      bind: file.bind ?? DEFAULT_STOA_CONFIG.bind,
    };
  } catch {
    return { ...DEFAULT_STOA_CONFIG, identity: { ...DEFAULT_STOA_CONFIG.identity }, auth: { ...DEFAULT_STOA_CONFIG.auth } };
  }
}

export function parseConfig(
  argv: string[],
  env: Record<string, string | undefined> = process.env
): VaultConfig {
  let vaultPath: string | undefined;
  let mcpMode = false;
  let defaultWiki: string | undefined;
  let defaultFamily: string | undefined;

  for (const arg of argv) {
    if (arg === "--mcp") mcpMode = true;
    else if (arg.startsWith("--vault=")) vaultPath = arg.slice("--vault=".length);
    else if (arg.startsWith("--default-wiki=")) defaultWiki = arg.slice("--default-wiki=".length);
    else if (arg.startsWith("--default-family=")) defaultFamily = arg.slice("--default-family=".length);
  }

  if (!vaultPath) vaultPath = env.STOA_VAULT_PATH;

  if (!vaultPath) {
    throw new ConfigError(
      "vault path required: pass --vault=<path> or set STOA_VAULT_PATH"
    );
  }

  vaultPath = resolve(vaultPath);

  return { vaultPath, mcpMode, defaultWiki, defaultFamily };
}
