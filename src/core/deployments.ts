import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

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
 */
export interface DeploymentEntry {
  repo_path: string;
  target: "claude-code" | "openclaw" | "codex";
  mode: DeployMode;
  actual_mode?: DeployMode;
  synced_at: string;
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
    for (const id of Object.keys(raw)) {
      raw[id] = (raw[id] ?? []).map(e => ({
        ...e,
        actual_mode: e.actual_mode ?? e.mode
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
