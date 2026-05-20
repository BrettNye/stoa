// vault-mcp/src/tools/list-platform-profiles.ts
//
// MCP tool exposing the draft pool — one row per registered platform profile
// in the resolved wiki. Per spec §1.1 of
// `wikis/_meta/specs/spec-stadium-substrate-fix-and-discovery-design.md`.
//
// Reads profile files directly from disk. `_index/pages.json` is used to
// enumerate profile page IDs when available (avoids an extra disk walk for
// large wikis), but falls back to a direct readdir when the index is absent
// or stale. Callers reindex first when freshness matters.

import { z } from "zod";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveTrainerContext, type ResolveTrainerContextOpts } from "../core/resolve-trainer-context.js";
import { parseFrontmatter } from "../core/frontmatter.js";
import { loadIndex } from "../core/index.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export type PlatformProfileRow = {
  platform_profile_id: string;
  pokemon: string;
  owner_trainer_id: string;
  real_skill_levels: Record<string, number>;
  profile_page_id: string;
  wiki: string;
};

// ─── Input schema ─────────────────────────────────────────────────────────────

export const listPlatformProfilesInput = z.object({
  wiki: z.string().optional(),
  owner_trainer_id: z
    .string()
    .regex(/^[0-9A-Z]{26}$/)
    .optional(),
});

// ─── Core function ────────────────────────────────────────────────────────────

/**
 * List all platform-registered profiles in the resolved wiki.
 *
 * @param input   - Optional `wiki` and `owner_trainer_id` filter.
 * @param opts    - Optional overrides for vault path / home dir (testability).
 *                  Falls back to `process.env.STOA_VAULT_PATH` when omitted.
 */
export async function listPlatformProfiles(
  input: z.infer<typeof listPlatformProfilesInput>,
  opts?: ResolveTrainerContextOpts
): Promise<{ profiles: PlatformProfileRow[]; caller_trainer_id: string }> {
  const vaultPath = opts?.vaultPath ?? process.env.STOA_VAULT_PATH ?? "";

  // Resolve trainer context for ambient caller_trainer_id and default wiki.
  const ctx = resolveTrainerContext({}, opts);
  const wiki = input.wiki ?? ctx.wiki;

  // ─── Enumerate profile files ──────────────────────────────────────────────
  // Prefer _index/pages.json to avoid a raw disk walk; fall back to readdirSync.
  const profileIds = enumerateProfileIds(vaultPath, wiki);

  // ─── Hydrate each profile ─────────────────────────────────────────────────
  const rows: PlatformProfileRow[] = [];
  for (const pageId of profileIds) {
    const filePath = join(vaultPath, "wikis", wiki, "profiles", `${pageId}.md`);
    if (!existsSync(filePath)) continue;

    let frontmatter: Record<string, unknown>;
    try {
      const raw = readFileSync(filePath, "utf8");
      ({ frontmatter } = parseFrontmatter(raw));
    } catch {
      continue; // skip malformed files
    }

    // Filter: only profiles with platform_profile_id
    const platform_profile_id = frontmatter.platform_profile_id as string | undefined;
    if (!platform_profile_id || typeof platform_profile_id !== "string") continue;
    if (!/^[0-9A-Z]{26}$/.test(platform_profile_id)) continue;

    const owner_trainer_id = String(frontmatter.owner_trainer_id ?? "");

    // Optional filter by owner_trainer_id
    if (input.owner_trainer_id && owner_trainer_id !== input.owner_trainer_id) continue;

    const pokemon = String(
      frontmatter.pokemon ?? frontmatter.species_name ?? pageId.replace(/^profile-/, "")
    );

    // Hydrate real_skill_levels from moveset
    const moveset = Array.isArray(frontmatter.moveset)
      ? (frontmatter.moveset as string[])
      : [];
    const real_skill_levels = hydrateRealSkillLevels(vaultPath, wiki, moveset);

    rows.push({
      platform_profile_id,
      pokemon,
      owner_trainer_id,
      real_skill_levels,
      profile_page_id: pageId,
      wiki,
    });
  }

  return { profiles: rows, caller_trainer_id: ctx.trainerId };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Returns profile page IDs for the given wiki.
 * Uses `_index/pages.json` when available, otherwise walks the profiles dir.
 */
function enumerateProfileIds(vaultPath: string, wiki: string): string[] {
  // Try index first
  try {
    const idx = loadIndex(vaultPath);
    const fromIndex = idx.pages
      .filter((p) => p.wiki === wiki && p.type === "profile")
      .map((p) => p.id);
    if (fromIndex.length > 0) return fromIndex;
  } catch {
    // fall through to disk walk
  }

  // Fall back to readdir
  const profilesDir = join(vaultPath, "wikis", wiki, "profiles");
  if (!existsSync(profilesDir)) return [];
  try {
    return readdirSync(profilesDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""));
  } catch {
    return [];
  }
}

/**
 * Reads each move SKILL.md in the wiki and collects skill_id → level.
 * Level is 0 (no XP fetched — this surface is read-only from the vault).
 * Only moves that have a `real_skill_id` frontmatter field are included.
 */
function hydrateRealSkillLevels(
  vaultPath: string,
  wiki: string,
  moveset: string[]
): Record<string, number> {
  const result: Record<string, number> = {};
  if (moveset.length === 0) return result;

  for (const moveId of moveset) {
    // Moves live in wikis/<wiki>/moves/<moveId>/SKILL.md
    const skillPath = join(vaultPath, "wikis", wiki, "moves", moveId, "SKILL.md");
    if (!existsSync(skillPath)) continue;

    let fm: Record<string, unknown>;
    try {
      const raw = readFileSync(skillPath, "utf8");
      ({ frontmatter: fm } = parseFrontmatter(raw));
    } catch {
      continue;
    }

    const realSkillId = fm.real_skill_id;
    if (!realSkillId || typeof realSkillId !== "string") continue;

    // TODO: replace with stadium-platform GET when available; current value is a registration baseline.
    // Key is real_skill_id (the platform-registered skill identifier), NOT moveId (a vault concept).
    result[realSkillId] = 0;
  }

  return result;
}

// ─── MCP tool definition ──────────────────────────────────────────────────────

export const listPlatformProfilesTool = {
  name: "vault_list-platform-profiles",
  description:
    "List all platform-registered profiles in the resolved wiki. Returns the draft pool with real_skill_levels per profile.",
  inputSchema: listPlatformProfilesInput,
  handler: async (
    input: z.infer<typeof listPlatformProfilesInput>,
    ctx: { vaultPath: string }
  ) => {
    return listPlatformProfiles(input, { vaultPath: ctx.vaultPath });
  },
};
