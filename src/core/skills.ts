import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { readProfile } from "./profiles.js";
import { parseFrontmatter } from "./frontmatter.js";
import { recordDeployment } from "./deployments.js";

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
      // Replace
      try {
        cpSync(moveSrcDir, destDir, { recursive: true, force: true });
      } catch {
        // ignore — overwrite of symlink target may fail
      }
    } else if (input.mode === "symlink") {
      try {
        symlinkSync(moveSrcDir, destDir, "junction");
      } catch {
        // fall back to copy on platforms / permissions where symlinks fail
        cpSync(moveSrcDir, destDir, { recursive: true });
      }
    } else {
      cpSync(moveSrcDir, destDir, { recursive: true });
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
    synced_at: new Date().toISOString()
  });

  return {
    skills_dir: skillsDir,
    moves_synced: synced,
    moves_skipped_unsupported: skipped
  };
}
