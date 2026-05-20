import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readProfile } from "./profiles.js";
import { parseFrontmatter } from "./frontmatter.js";
import { recordDeployment, type DeploymentEntry } from "./deployments.js";
import * as skillsPlatform from "./skills-platform.js";

export type SyncTarget = "claude-code" | "openclaw" | "codex";
export type SyncMode = "copy" | "symlink";

export interface SyncInput {
  vaultPath: string;
  repoPath: string;
  pokemon_id: string;
  target: SyncTarget;
  mode: SyncMode;
}

export interface SyncResult {
  skills_dir: string;
  moves_synced: string[];
  moves_skipped_unsupported: string[];
}

export function resolveSkillsDir(repoPath: string, target: SyncTarget, pokemonName: string): string {
  const targetDirMap: Record<SyncTarget, string> = {
    "claude-code": ".claude",
    "openclaw":    ".openclaw",
    "codex":       ".codex"
  };
  return join(repoPath, targetDirMap[target], "skills", pokemonName);
}

function pokemonNameFromId(profile_id: string): string {
  return profile_id.startsWith("profile-")
    ? profile_id.slice("profile-".length)
    : profile_id;
}

export function syncMoveset(input: SyncInput): SyncResult {
  const profile = readProfile(input.vaultPath, input.pokemon_id);
  const moveset: string[] = Array.isArray(profile.frontmatter.moveset)
    ? profile.frontmatter.moveset
    : [];

  const pokemonName = pokemonNameFromId(input.pokemon_id);
  const skillsDir = resolveSkillsDir(input.repoPath, input.target, pokemonName);
  mkdirSync(skillsDir, { recursive: true });

  const synced: string[] = [];
  const skipped: string[] = [];

  // Track the actual_mode that lands on disk. If any move falls back to copy,
  // the registry entry's actual_mode degrades to "copy". A single all-symlink
  // run reports actual_mode === requested.
  let actualMode: SyncMode = input.mode;

  for (const moveId of moveset) {
    const moveSrcDir = join(input.vaultPath, "wikis", "_agents", "moves", moveId);
    const skillPath = join(moveSrcDir, "SKILL.md");
    if (!existsSync(skillPath)) {
      skipped.push(moveId);
      continue;
    }
    const raw = readFileSync(skillPath, "utf8");
    const { frontmatter } = parseFrontmatter(raw);
    const appliesTo: string[] = Array.isArray(frontmatter.applies_to)
      ? frontmatter.applies_to
      : ["claude-code", "openclaw", "codex"]; // default permissive
    if (!appliesTo.includes(input.target)) {
      skipped.push(moveId);
      continue;
    }

    const destDir = join(skillsDir, moveId);
    if (existsSync(destDir)) {
      // Re-deploy: clear existing dest first so deployMove sees a clean slate.
      // rmSync(force: true) tolerates both real dirs and symlink/junction targets.
      rmSync(destDir, { recursive: true, force: true });
    }
    const result = skillsPlatform.deployMove(moveSrcDir, destDir, input.mode);
    if (result.actual_mode === "copy") {
      // Any single fallback degrades the run-level actual_mode.
      actualMode = "copy";
    }
    synced.push(moveId);
  }

  // Write manifest
  const manifest = {
    pokemon_id: input.pokemon_id,
    target: input.target,
    mode: input.mode,
    vault_path: input.vaultPath,
    moves: synced,
    synced_at: new Date().toISOString()
  };
  writeFileSync(join(skillsDir, "_pokemon.json"), JSON.stringify(manifest, null, 2));

  recordDeployment(input.vaultPath, input.pokemon_id, {
    repo_path: input.repoPath,
    target: input.target,
    mode: input.mode,
    actual_mode: actualMode,
    synced_at: new Date().toISOString()
  });

  return {
    skills_dir: skillsDir,
    moves_synced: synced,
    moves_skipped_unsupported: skipped
  };
}

/**
 * Remove the deployed skills directory for a given deployment entry.
 *
 * Used by `vault_evolve-profile` (Wave 3 Task 3-1) when
 * `cleanup_old_skills_dir: true` to remove the pre-rename directory before
 * re-deploying under the new pokemon name. Spec §6.3.
 *
 * The deployed path is reconstructed via the same `resolveSkillsDir`
 * convention `syncMoveset` uses to write — using `repo_path` + `target` from
 * the entry plus the bare pokemon name derived from the `pokemonId` argument.
 * The bare name is NOT stored on the entry (Plan A: schema delta is purely
 * additive, only `actual_mode`); the caller is the registry and already knows
 * the keying id.
 *
 * Idempotent: `fs.rmSync(..., { force: true })` tolerates a missing target,
 * so a second call (or a call when the dir was never created) is a no-op.
 */
export function removeOldDeployment(deployment: DeploymentEntry, pokemonId: string): void {
  const bareName = pokemonNameFromId(pokemonId);
  const skillsDir = resolveSkillsDir(deployment.repo_path, deployment.target, bareName);
  rmSync(skillsDir, { recursive: true, force: true });
}
