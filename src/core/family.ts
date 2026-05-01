import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Per-family rollup emitted in `_index/wikis.json`. See spec §5.2.
 *
 * `members` and `modes_used` are both sorted; `modes_used` is also deduped.
 */
export interface FamilyRollup {
  members: string[];
  total_pages: number;
  modes_used: string[];
}

/**
 * Context for `resolveFamily`. Carries vault root + the
 * `--default-family` MCP-server-level override (Phase 2 Task 3-6).
 */
export interface FamilyResolveCtx {
  vaultPath: string;
  defaultFamily?: string;
}

/**
 * Raised when an explicit `family:` and explicit `wiki:` are both passed
 * but the wiki's declared family does not match. Surfaces as a structured
 * error to the tool layer rather than a silent override.
 */
export class FamilyMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FamilyMismatchError";
  }
}

/**
 * Walks the v1.6 §7.1 family resolution chain:
 *
 *   1. Explicit `familyArg` wins.
 *   2. `ctx.defaultFamily` (from `--default-family` MCP CLI arg).
 *   3. `<vaultPath>/.active-family` file (trimmed; empty → ignore).
 *   4. null → caller falls through to single-wiki resolution.
 *
 * If both `familyArg` and `wikiArg` are provided AND `knownWikis` is provided,
 * sanity-checks that `knownWikis[wikiArg].family === familyArg`. Throws
 * `FamilyMismatchError` on mismatch (or if the wiki is unknown).
 *
 * Explicit `wikiArg` alone (no `familyArg`) intentionally returns null —
 * we do NOT auto-broaden a single-wiki call into a family-scope call.
 */
export function resolveFamily(
  ctx: FamilyResolveCtx,
  familyArg?: string,
  wikiArg?: string,
  knownWikis?: Record<string, { family?: string | null }>
): string | null {
  if (familyArg !== undefined && familyArg !== null && familyArg !== "") {
    if (wikiArg !== undefined && knownWikis !== undefined) {
      const wikiEntry = knownWikis[wikiArg];
      const wikiFamily = wikiEntry?.family ?? null;
      if (wikiFamily !== familyArg) {
        throw new FamilyMismatchError(
          `wiki '${wikiArg}' has family '${wikiFamily ?? "(none)"}' which does not match requested family '${familyArg}'`
        );
      }
    }
    return familyArg;
  }

  if (ctx.defaultFamily !== undefined && ctx.defaultFamily !== "") {
    return ctx.defaultFamily;
  }

  const activeFamilyPath = join(ctx.vaultPath, ".active-family");
  if (existsSync(activeFamilyPath)) {
    const raw = readFileSync(activeFamilyPath, "utf8").trim();
    if (raw.length > 0) {
      return raw;
    }
  }

  return null;
}

/**
 * Aggregates a flat wiki map into per-family rollups (spec §5.2).
 *
 * - Wikis with no `family` field or `family: null` are excluded.
 * - `members` is sorted alphabetically.
 * - `total_pages` sums `page_count` (missing → 0).
 * - `modes_used` is deduped + sorted.
 */
export function aggregateFamilies(
  wikis: Record<
    string,
    { name: string; mode: string; family?: string | null; page_count?: number }
  >
): Record<string, FamilyRollup> {
  const buckets: Record<
    string,
    { members: Set<string>; total_pages: number; modes: Set<string> }
  > = {};

  for (const [wikiName, entry] of Object.entries(wikis)) {
    const fam = entry.family;
    if (fam === undefined || fam === null || fam === "") continue;

    if (!buckets[fam]) {
      buckets[fam] = { members: new Set(), total_pages: 0, modes: new Set() };
    }
    buckets[fam].members.add(wikiName);
    buckets[fam].total_pages += entry.page_count ?? 0;
    buckets[fam].modes.add(entry.mode);
  }

  const out: Record<string, FamilyRollup> = {};
  for (const [fam, bucket] of Object.entries(buckets)) {
    out[fam] = {
      members: [...bucket.members].sort(),
      total_pages: bucket.total_pages,
      modes_used: [...bucket.modes].sort(),
    };
  }
  return out;
}

/**
 * Returns the wiki names whose `family` field equals `family` (case-sensitive),
 * sorted alphabetically.
 */
export function membersOf(
  family: string,
  wikis: Record<string, { family?: string | null }>
): string[] {
  const out: string[] = [];
  for (const [wikiName, entry] of Object.entries(wikis)) {
    if (entry.family === family) {
      out.push(wikiName);
    }
  }
  return out.sort();
}
