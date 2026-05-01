import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeName } from "./runtime-adapters/types.js";

export type DeployMode = "copy" | "symlink";

/**
 * v1.6 Phase 1 schema delta (additive only):
 *  - `actual_mode` records what actually landed on disk after `deployMove`.
 *    On Windows, a `requested: "symlink"` deploy may fall back to copy
 *    without admin privilege; `actual_mode` reflects the truth, while
 *    `mode` preserves the operator's request. Spec §3.1, §5.4.
 *
 * v1.5 entries (which lack `actual_mode`) are read with a graceful
 * default: `actual_mode = mode`. Plan A Notes #8.
 *
 * v1.7 §6.4 invariant 5 — additive schema delta:
 *  - `runtime` names the deployment's target runtime (Claude Code today;
 *    OpenClaw in v1.8). v1.5/1.6 entries lack this field; on read it
 *    defaults to the existing `target` value (the legacy union coincides
 *    with the v1.7 RuntimeName for the single shipped runtime).
 *  - `source_revision` records the git rev (or content hash) of the
 *    profile/moveset that produced this deployment. `vault.sync-agents`
 *    uses it to short-circuit idempotent re-deploys.
 *  - `subagent_def_path` is the absolute path of the runtime-specific
 *    artifact written on disk (e.g. `<repo>/.claude/agents/<id>.md`).
 *    Used by `remove()` for clean reversal.
 */
export interface DeploymentEntry {
  repo_path: string;
  target: "claude-code" | "openclaw" | "codex";
  mode: DeployMode;
  actual_mode?: DeployMode;
  synced_at: string;

  // v1.7 §6.4 invariant 5 — runtime + source_revision + subagent_def_path
  runtime?: RuntimeName;
  source_revision?: string;
  subagent_def_path?: string;
}

export type DeploymentRegistry = Record<string, DeploymentEntry[]>;

function regPath(vaultPath: string): string {
  return join(vaultPath, "_index", "deployments.json");
}

export function readDeployments(vaultPath: string): DeploymentRegistry {
  const p = regPath(vaultPath);
  if (!existsSync(p)) return {};
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as DeploymentRegistry;
    // Back-compat: v1.5 entries lack actual_mode. Default to mode.
    // v1.7 — back-compat: v1.5/1.6 entries lack runtime; default to target
    // (the existing values "claude-code"/"openclaw"/"codex" coincide with
    // the v1.7 RuntimeName union for v1.7's single shipped runtime).
    for (const id of Object.keys(raw)) {
      raw[id] = (raw[id] ?? []).map(e => ({
        ...e,
        actual_mode: e.actual_mode ?? e.mode,
        runtime: e.runtime ?? (e.target as RuntimeName),
      }));
    }
    return raw;
  } catch {
    return {};
  }
}

function writeDeployments(vaultPath: string, reg: DeploymentRegistry): void {
  mkdirSync(join(vaultPath, "_index"), { recursive: true });
  writeFileSync(regPath(vaultPath), JSON.stringify(reg, null, 2));
}

export function recordDeployment(vaultPath: string, pokemonId: string, entry: DeploymentEntry): void {
  const reg = readDeployments(vaultPath);
  const list = reg[pokemonId] ?? [];
  const filtered = list.filter(e => !(e.repo_path === entry.repo_path && e.target === entry.target));
  filtered.push(entry);
  reg[pokemonId] = filtered;
  writeDeployments(vaultPath, reg);
}

export function migrateDeploymentKey(vaultPath: string, oldId: string, newId: string): void {
  const reg = readDeployments(vaultPath);
  if (!reg[oldId]) return;
  reg[newId] = [...(reg[newId] ?? []), ...reg[oldId]];
  delete reg[oldId];
  writeDeployments(vaultPath, reg);
}

/**
 * v1.7 §6.4 invariant 5 — O(1)-ish lookup of a deployment by
 * (profileId, repoPath). Used by `vault.sync-agents` to short-circuit
 * idempotent re-deploys: when the existing entry's `source_revision`
 * matches the freshly-built intent's revision, no work is performed.
 */
export function getDeployment(
  vaultPath: string,
  profileId: string,
  repoPath: string
): DeploymentEntry | undefined {
  const reg = readDeployments(vaultPath);
  return (reg[profileId] ?? []).find(e => e.repo_path === repoPath);
}
