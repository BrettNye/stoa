import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync } from "node:fs";
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
  /**
   * Wiki context for the deploy. When set (and not `_agents`), `syncMoveset`
   * additionally walks `wikis/<wiki>/moves/<id>/SKILL.md` and layers any
   * matching moves on top of the profile's portable moveset. Spec §4.3.
   *
   * Optional for back-compat — `evolve-profile` and `sync-agents` call
   * `syncMoveset` without a wiki argument (they resync existing deployments
   * keyed by the profile, not the wiki). Omitting it preserves pre-T10
   * behavior: portable-only.
   */
  wiki?: string;
}

export interface SyncResult {
  skills_dir: string;
  /** All moves deployed — union of portable + wiki-local. Unchanged from pre-T10. */
  moves_synced: string[];
  moves_skipped_unsupported: string[];
  /** Subset of `moves_synced` drawn from the profile's portable moveset. T10 (spec §4.3). */
  moves_synced_portable: string[];
  /** Subset of `moves_synced` drawn from `wikis/<wiki>/moves/`. T10 (spec §4.3). */
  moves_synced_wiki_local: string[];
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
  const syncedPortable: string[] = [];
  const syncedWikiLocal: string[] = [];
  const skipped: string[] = [];

  // Track the actual_mode that lands on disk. If any move falls back to copy,
  // the registry entry's actual_mode degrades to "copy". A single all-symlink
  // run reports actual_mode === requested.
  let actualMode: SyncMode = input.mode;

  /**
   * Deploy a single move from its source directory into the skills dir,
   * honoring applies_to and tracking actual_mode degradation. Returns
   * `"synced"`, `"skipped-missing"`, or `"skipped-applies-to"`. Shared
   * across the portable-moveset loop and the wiki-local pass so deployment
   * semantics stay identical between layers (T10, spec §4.3).
   */
  const tryDeployMove = (
    moveId: string,
    moveSrcDir: string,
  ): "synced" | "skipped-missing" | "skipped-applies-to" => {
    const skillPath = join(moveSrcDir, "SKILL.md");
    if (!existsSync(skillPath)) {
      return "skipped-missing";
    }
    const raw = readFileSync(skillPath, "utf8");
    const { frontmatter } = parseFrontmatter(raw);
    const appliesTo: string[] = Array.isArray(frontmatter.applies_to)
      ? frontmatter.applies_to
      : ["claude-code", "openclaw", "codex"]; // default permissive
    if (!appliesTo.includes(input.target)) {
      return "skipped-applies-to";
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
    return "synced";
  };

  // Pass 1: portable moveset from the profile (wikis/_agents/moves/).
  for (const moveId of moveset) {
    const moveSrcDir = join(input.vaultPath, "wikis", "_agents", "moves", moveId);
    const outcome = tryDeployMove(moveId, moveSrcDir);
    if (outcome === "synced") {
      synced.push(moveId);
      syncedPortable.push(moveId);
    } else {
      // Both skip reasons feed the same `moves_skipped_unsupported` list to
      // preserve pre-T10 behavior. (The applies_to filter and missing-SKILL.md
      // both produce skips here; differentiating them is out of scope for T10.)
      skipped.push(moveId);
    }
  }

  // Pass 2: wiki-local moves at wikis/<input.wiki>/moves/<id>/SKILL.md.
  // Skip when no wiki is supplied (back-compat for evolve-profile / sync-agents)
  // or when the wiki IS `_agents` — the portable loop already owns that path
  // and a second walk would produce duplicates (spec §4.3 note).
  if (input.wiki && input.wiki !== "_agents") {
    const wikiMovesRoot = join(input.vaultPath, "wikis", input.wiki, "moves");
    if (existsSync(wikiMovesRoot)) {
      let entries: string[] = [];
      try {
        entries = readdirSync(wikiMovesRoot);
      } catch {
        // Permission issue or stat race — degrade to no wiki-local layer
        // rather than crashing the entire deploy.
        entries = [];
      }
      // Deterministic iteration order so test assertions on the wiki-local
      // list are stable regardless of fs enumeration order.
      entries.sort();
      for (const moveId of entries) {
        const moveSrcDir = join(wikiMovesRoot, moveId);
        try {
          if (!statSync(moveSrcDir).isDirectory()) continue;
        } catch {
          continue;
        }
        // Collision rule (spec §4.4): portable wins. If the move id is
        // already in `synced` (deployed by the portable loop above), skip
        // the wiki-local copy silently. Lint surfaces the shadowing.
        if (synced.includes(moveId)) {
          continue;
        }
        const outcome = tryDeployMove(moveId, moveSrcDir);
        if (outcome === "synced") {
          synced.push(moveId);
          syncedWikiLocal.push(moveId);
        }
        // Wiki-local applies_to / missing-SKILL.md skips are NOT pushed to
        // `moves_skipped_unsupported`. That list documents moves the profile
        // declared but couldn't deploy; a wiki-local move that simply doesn't
        // apply to this runtime is not a contract violation.
      }
    }
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
    moves_skipped_unsupported: skipped,
    moves_synced_portable: syncedPortable,
    moves_synced_wiki_local: syncedWikiLocal,
  };
}

/**
 * Parse the `scope_wiki` field from a move's SKILL.md frontmatter.
 *
 * T7 (specialist-agent-substrate §4.2) — additive read-only helper.
 * Returns `{ scopeWiki: string[] }` where `scopeWiki` is the parsed
 * `scope_wiki:` array, defaulting to `[]` when absent.
 *
 * Deployment layering based on scopeWiki is T10's concern; this helper
 * only provides observable parse access for tests.
 */
export function parseMoveScope(vaultPath: string, moveId: string): { scopeWiki: string[] } {
  const skillPath = join(vaultPath, "wikis", "_agents", "moves", moveId, "SKILL.md");
  const raw = readFileSync(skillPath, "utf8");
  const { frontmatter } = parseFrontmatter(raw);
  const scopeWiki: string[] = Array.isArray(frontmatter.scope_wiki)
    ? frontmatter.scope_wiki.map(String)
    : [];
  return { scopeWiki };
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
