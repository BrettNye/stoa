// src/tools/stadium-list.ts
//
// Consolidated "Stadium list" tool — replaces the former vault_list-invites
// and vault_list-platform-profiles tools. Dispatches on `mode`.
//
// The implementation of listPlatformProfiles is inlined here (formerly in
// list-platform-profiles.ts) so that the deleted sibling file is not imported.

import { z } from "zod";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveStadiumConfig } from "../core/stadium-config.js";
import { StadiumClient } from "../core/stadium-client.js";
import { resolveTrainerContext, type ResolveTrainerContextOpts } from "../core/resolve-trainer-context.js";
import { parseFrontmatter } from "../core/frontmatter.js";
import { loadIndex } from "../core/index.js";
import type { ToolScope } from "../auth/types.js";

// ─── Public types (re-exported for downstream consumers) ──────────────────────

export type PlatformProfileRow = {
  platform_profile_id: string;
  pokemon: string;
  owner_trainer_id: string;
  real_skill_levels: Record<string, number>;
  profile_page_id: string;
  wiki: string;
};

// ─── Input schema ──────────────────────────────────────────────────────────────

const Input = z.object({
  mode: z.enum(["invites", "platform-profiles"]),
  wiki: z.string().optional(),
  // M1: platform-profiles carries an owner_trainer_id ULID filter — do NOT drop it.
  owner_trainer_id: z
    .string()
    .regex(/^[0-9A-Z]{26}$/)
    .optional(),
});

// ─── Scope ─────────────────────────────────────────────────────────────────────
//
// M2: wiki-aware for both modes. When `wiki` is provided, scope narrows to
// `wikis/<wiki>`; otherwise `wikis/*`. For invites, callers never set `wiki` so
// the axis resolves to "wikis/*" naturally.

const scope: ToolScope = {
  axis: (i: unknown) =>
    i != null &&
    typeof i === "object" &&
    typeof (i as any).wiki === "string"
      ? `wikis/${(i as any).wiki}`
      : "wikis/*",
};

// ─── Platform-profiles implementation (formerly list-platform-profiles.ts) ────

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

/**
 * List all platform-registered profiles in the resolved wiki.
 *
 * @param input   - Optional `wiki` and `owner_trainer_id` filter.
 * @param opts    - Optional overrides for vault path / home dir (testability).
 *                  Falls back to `process.env.STOA_VAULT_PATH` when omitted.
 */
export async function listPlatformProfiles(
  input: { wiki?: string; owner_trainer_id?: string },
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

// ─── Handler delegates ─────────────────────────────────────────────────────────

async function runListInvites(
  _input: z.infer<typeof Input>,
  _ctx: { vaultPath?: string }
) {
  const config = resolveStadiumConfig();
  const client = new StadiumClient({ api_key: config.api_key, base_url: config.base_url });
  return client.listInvites();
}

async function runListPlatformProfiles(
  input: z.infer<typeof Input>,
  ctx: { vaultPath?: string }
) {
  return listPlatformProfiles(
    { wiki: input.wiki, owner_trainer_id: input.owner_trainer_id },
    { vaultPath: ctx.vaultPath }
  );
}

// ─── Tool definition ───────────────────────────────────────────────────────────

export const stadiumListTool = {
  name: "vault_stadium-list",
  description:
    "List Stadium resources. mode: invites (pending match invites) | platform-profiles (registered draft-pool profiles).",
  inputSchema: Input,
  scope,
  handler: async (input: z.infer<typeof Input>, ctx: { vaultPath?: string }) =>
    input.mode === "invites"
      ? runListInvites(input, ctx)
      : runListPlatformProfiles(input, ctx),
};
