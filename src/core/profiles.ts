import { existsSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { readPage, writePage } from "./pages.js";
import { parseFrontmatter } from "./frontmatter.js";
import { readFileSync } from "node:fs";
import { recordRename, resolveCurrent, expandAliases } from "./aliases.js";
import { listTasks } from "./tasks.js";

export class ProfileNotFoundError extends Error {
  constructor(public id: string) {
    super(`profile not found: ${id}`);
    this.name = "ProfileNotFoundError";
  }
}

export interface ProfileInput {
  id: string;
  title: string;
  pokemon_type: string;
  secondary_pokemon_type?: string;
  region?: string;
  evolution_stage: "basic" | "stage1" | "stage2";
  autonomy_level?: "restricted" | "feature-branch" | "main-branch";
  moveset: string[];
  summary: string;
  applies_to?: string[];
  channels_tailed?: string[];
  body?: string;
  previous_names?: string[];
  expected_updated?: string;
}

export interface ProfileSummary {
  id: string;
  title: string;
  pokemon_type: string;
  evolution_stage: string;
  moveset: string[];
}

export function readProfile(vaultPath: string, id: string): { frontmatter: Record<string, any>; body: string; updated: string; path: string } {
  const profilesDir = join(vaultPath, "wikis", "_agents", "profiles");

  // Three-step resolution chain (v1.6 §7.5):
  //   1. raw id            (e.g. "profile-charmeleon")
  //   2. profile-<id>      (bare-name normalization, e.g. "charmeleon")
  //   3. alias overlay     (historical id → current id, then retry steps 1-2)
  //
  // The alias index (core/aliases.ts) is keyed by historical id with
  // value.current = current canonical id. resolveCurrent() returns the
  // input unchanged if no alias entry exists.
  const candidates = [id, `profile-${id}`];
  for (const cand of candidates) {
    const path = join(profilesDir, `${cand}.md`);
    if (existsSync(path)) {
      return loadProfileAt(path);
    }
  }

  // Alias overlay: try to resolve via the alias index using both id forms
  // as lookup keys, then retry the candidate chain with each resolved id.
  for (const lookupKey of candidates) {
    const current = resolveCurrent(vaultPath, lookupKey);
    if (current === lookupKey) continue; // no alias entry for this key
    const aliasCandidates = [current, `profile-${current}`];
    for (const cand of aliasCandidates) {
      const path = join(profilesDir, `${cand}.md`);
      if (existsSync(path)) {
        return loadProfileAt(path);
      }
    }
  }

  throw new ProfileNotFoundError(id);
}

function loadProfileAt(path: string): { frontmatter: Record<string, any>; body: string; updated: string; path: string } {
  const raw = readFileSync(path, "utf8");
  const { frontmatter, body } = parseFrontmatter(raw);
  return {
    frontmatter, body, path,
    updated: String(frontmatter.updated ?? frontmatter.created ?? "")
  };
}

export function writeProfile(vaultPath: string, input: ProfileInput): { id: string; path: string; updated: string } {
  const today = new Date().toISOString().slice(0, 10);
  const STAGE_TO_AUTONOMY: Record<string, string> = {
    basic: "restricted", stage1: "feature-branch", stage2: "main-branch"
  };
  const fm: Record<string, any> = {
    id: input.id,
    title: input.title,
    type: "profile",
    wiki: "_agents",
    status: "active",
    created: today,
    updated: today,
    summary: input.summary,
    pokemon_type: input.pokemon_type,
    evolution_stage: input.evolution_stage,
    autonomy_level: input.autonomy_level ?? STAGE_TO_AUTONOMY[input.evolution_stage] ?? "restricted",
    moveset: input.moveset,
    applies_to: input.applies_to ?? ["claude-code"]
  };
  if (input.secondary_pokemon_type) fm.secondary_pokemon_type = input.secondary_pokemon_type;
  if (input.region) fm.region = input.region;
  if (input.channels_tailed) fm.channels_tailed = input.channels_tailed;
  if (input.previous_names) fm.previous_names = input.previous_names;

  return writePage(vaultPath, {
    id: input.id,
    type: "profile",
    wiki: "_agents",
    frontmatter: fm,
    body: input.body ?? `# ${input.title}\n\n(role description)`,
    expectedUpdated: input.expected_updated
  });
}

export function listProfiles(vaultPath: string): ProfileSummary[] {
  const profilesDir = join(vaultPath, "wikis", "_agents", "profiles");
  if (!existsSync(profilesDir)) return [];
  const entries = readdirSync(profilesDir).filter(f => f.endsWith(".md"));
  const out: ProfileSummary[] = [];
  for (const file of entries) {
    const id = file.replace(/\.md$/, "");
    try {
      const p = readProfile(vaultPath, id);
      out.push({
        id,
        title: String(p.frontmatter.title ?? id),
        pokemon_type: String(p.frontmatter.pokemon_type ?? "normal"),
        evolution_stage: String(p.frontmatter.evolution_stage ?? "basic"),
        moveset: Array.isArray(p.frontmatter.moveset) ? p.frontmatter.moveset : []
      });
    } catch {
      // skip malformed
    }
  }
  return out;
}

export interface ProfileEnriched extends ProfileSummary {
  wiki: string;
  pokemon: string;
  updated: string;
  claimedTaskCount: number;
  /** Role description from frontmatter summary field. Empty/whitespace stubs are normalized to undefined. */
  summary?: string;
  /** True when frontmatter has `system: true`. Indicates a reserved system profile (e.g. merge orchestrator). */
  system?: boolean;
}

export interface ListProfilesEnrichedOptions {
  wiki?: string;
}

/**
 * Returns ProfileSummary fields plus `wiki`, `pokemon`, `updated` (mtime), and
 * `claimedTaskCount` for all agent profiles across the vault.
 *
 * `listTasks` is called once across all wikis and the results are bucketed by
 * agent id to avoid N+1 disk reads per profile.
 *
 * `pokemon` resolution order: frontmatter `pokemon:` → `species_name:` → bare slug
 * derived from the profile id (strip `profile-` prefix).
 *
 * `claimedTaskCount` counts tasks whose `claimed_by` matches `agent:<bare-id>` or
 * any historical alias of that agent (same alias expansion used in task-list tool).
 */
export function listProfilesEnriched(
  vaultPath: string,
  opts: ListProfilesEnrichedOptions = {}
): ProfileEnriched[] {
  // Build the set of wiki dirs to scan. Profiles currently live only in _agents,
  // but we scan all wikis defensively so this works if profiles are ever scoped
  // to other wikis.
  const wikisDir = join(vaultPath, "wikis");
  if (!existsSync(wikisDir)) return [];

  const wikiNames: string[] = readdirSync(wikisDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  // Collect raw profile entries first (before task bucketing) so we know all
  // profile ids before touching listTasks.
  interface RawEntry {
    id: string;
    title: string;
    pokemon_type: string;
    evolution_stage: string;
    moveset: string[];
    wiki: string;
    pokemon: string;
    updated: string;
    filePath: string;
    summary?: string;
    system?: boolean;
  }

  const rawEntries: RawEntry[] = [];

  for (const wikiName of wikiNames) {
    if (opts.wiki && wikiName !== opts.wiki) continue;
    const profilesDir = join(wikisDir, wikiName, "profiles");
    if (!existsSync(profilesDir)) continue;
    const files = readdirSync(profilesDir).filter(f => f.endsWith(".md"));
    for (const file of files) {
      const filePath = join(profilesDir, file);
      try {
        const raw = readFileSync(filePath, "utf8");
        const { frontmatter: fm } = parseFrontmatter(raw);
        const mtime = statSync(filePath).mtime;
        const id = file.replace(/\.md$/, "");

        // wiki: prefer frontmatter, fall back to parent wiki dir name
        const wiki = fm.wiki ? String(fm.wiki) : wikiName;

        // pokemon: frontmatter `pokemon:` → `species_name:` → bare slug (strip `profile-`)
        let pokemon: string;
        if (fm.pokemon) {
          pokemon = String(fm.pokemon);
        } else if (fm.species_name) {
          pokemon = String(fm.species_name);
        } else {
          pokemon = id.startsWith("profile-") ? id.slice("profile-".length) : id;
        }

        // summary: read from frontmatter, trim, normalize empty/whitespace to undefined
        let summary: string | undefined;
        if (fm.summary !== undefined && fm.summary !== null) {
          const trimmed = String(fm.summary).trim();
          summary = trimmed.length > 0 ? trimmed : undefined;
        }

        // system: only true when frontmatter explicitly has system: true
        const system: boolean | undefined = fm.system === true ? true : undefined;

        rawEntries.push({
          id,
          title: String(fm.title ?? id),
          pokemon_type: String(fm.pokemon_type ?? "normal"),
          evolution_stage: String(fm.evolution_stage ?? "basic"),
          moveset: Array.isArray(fm.moveset) ? fm.moveset : [],
          wiki,
          pokemon,
          updated: mtime.toISOString(),
          filePath,
          summary,
          system
        });
      } catch {
        // skip malformed
      }
    }
  }

  if (rawEntries.length === 0) return [];

  // Single listTasks call across all wikis — no limit so we get everything.
  const allTasks = listTasks(vaultPath, { status: "claimed", limit: Number.MAX_SAFE_INTEGER });

  // Build a map from agent id string → count, accounting for alias expansion.
  // We bucket by the exact `claimed_by` value on the task, then for each profile
  // we expand its own aliases and sum up matching task counts.
  const taskCountByClaimed = new Map<string, number>();
  for (const task of allTasks) {
    if (!task.claimed_by) continue;
    taskCountByClaimed.set(task.claimed_by, (taskCountByClaimed.get(task.claimed_by) ?? 0) + 1);
  }

  // Build enriched results
  const out: ProfileEnriched[] = [];
  for (const entry of rawEntries) {
    // Compute the set of claimed_by strings that correspond to this profile,
    // mirroring the expandClaimedBy logic in tools/task-list.ts.
    const bare = entry.id.startsWith("profile-") ? entry.id.slice("profile-".length) : entry.id;
    const profileId = entry.id.startsWith("profile-") ? entry.id : `profile-${entry.id}`;
    const expandedProfileIds = expandAliases(vaultPath, profileId);

    const agentIds = new Set<string>();
    // Always include the direct agent id
    agentIds.add(`agent:${bare}`);
    for (const pid of expandedProfileIds) {
      const pBare = pid.startsWith("profile-") ? pid.slice("profile-".length) : pid;
      agentIds.add(`agent:${pBare}`);
    }

    let claimedTaskCount = 0;
    for (const agentId of agentIds) {
      claimedTaskCount += taskCountByClaimed.get(agentId) ?? 0;
    }

    const enriched: ProfileEnriched = {
      id: entry.id,
      title: entry.title,
      pokemon_type: entry.pokemon_type,
      evolution_stage: entry.evolution_stage,
      moveset: entry.moveset,
      wiki: entry.wiki,
      pokemon: entry.pokemon,
      updated: entry.updated,
      claimedTaskCount
    };
    if (entry.summary !== undefined) enriched.summary = entry.summary;
    if (entry.system !== undefined) enriched.system = entry.system;
    out.push(enriched);
  }

  return out;
}

export function getMoveset(vaultPath: string, profile_id: string): string[] {
  const p = readProfile(vaultPath, profile_id);
  return Array.isArray(p.frontmatter.moveset) ? p.frontmatter.moveset : [];
}

export function renameProfile(vaultPath: string, oldId: string, newId: string): { oldPath: string; newPath: string } {
  const profilesDir = join(vaultPath, "wikis", "_agents", "profiles");
  const oldPath = join(profilesDir, `${oldId}.md`);
  const newPath = join(profilesDir, `${newId}.md`);

  if (!existsSync(oldPath)) {
    throw new ProfileNotFoundError(oldId);
  }
  if (existsSync(newPath)) {
    throw new Error(`profile id ${newId} already exists at ${newPath}`);
  }

  // Read old profile's frontmatter + body
  const old = readProfile(vaultPath, oldId);

  // Compose new frontmatter: clone old, swap id, append to previous_names
  const priorPreviousNames: string[] = Array.isArray(old.frontmatter.previous_names)
    ? old.frontmatter.previous_names
    : [];
  const newPreviousNames = [...priorPreviousNames, oldId];

  // Use writeProfile so frontmatter normalization is consistent.
  writeProfile(vaultPath, {
    id: newId,
    title: String(old.frontmatter.title ?? newId),
    pokemon_type: String(old.frontmatter.pokemon_type ?? "normal"),
    secondary_pokemon_type: old.frontmatter.secondary_pokemon_type
      ? String(old.frontmatter.secondary_pokemon_type)
      : undefined,
    region: old.frontmatter.region ? String(old.frontmatter.region) : undefined,
    evolution_stage: (old.frontmatter.evolution_stage ?? "basic") as "basic" | "stage1" | "stage2",
    autonomy_level: old.frontmatter.autonomy_level
      ? (old.frontmatter.autonomy_level as "restricted" | "feature-branch" | "main-branch")
      : undefined,
    moveset: Array.isArray(old.frontmatter.moveset) ? old.frontmatter.moveset : [],
    summary: String(old.frontmatter.summary ?? ""),
    applies_to: Array.isArray(old.frontmatter.applies_to) ? old.frontmatter.applies_to : ["claude-code"],
    channels_tailed: Array.isArray(old.frontmatter.channels_tailed) ? old.frontmatter.channels_tailed : undefined,
    body: old.body,
    previous_names: newPreviousNames
  });

  // Delete the old file
  unlinkSync(oldPath);

  // Record the rename in the alias index
  recordRename(vaultPath, oldId, newId);

  return { oldPath, newPath };
}
