import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface DeploymentEntry {
  repo_path: string;
  target: "claude-code" | "openclaw" | "codex";
  mode: "copy" | "symlink";
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
    return JSON.parse(readFileSync(p, "utf8")) as DeploymentRegistry;
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
