import { resolve } from "node:path";
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
