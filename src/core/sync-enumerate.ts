import { listProfiles } from "./profiles.js";
import { resolveCurrent } from "./aliases.js";
import { readProfile } from "./profiles.js";

export interface EnumerateOptions {
  exclude: string[];
  pokemon_type: string[];
}

/**
 * Enumerate profile ids from wikis/_agents/profiles/, then apply exclude
 * and pokemon_type filters. Returns sorted ids for stable output.
 *
 * - `exclude` ids are alias-resolved and may be passed as bare slugs.
 * - `pokemon_type` matches both primary and secondary types.
 * - Empty filter arrays mean "no filter applied".
 */
export function enumerateProfilesForSync(
  vaultPath: string,
  opts: EnumerateOptions
): string[] {
  const all = listProfiles(vaultPath);

  // Normalize exclude list: accept bare slugs, resolve aliases, then dedupe.
  const excludeSet = new Set<string>();
  for (const raw of opts.exclude) {
    const candidate = raw.startsWith("profile-") ? raw : `profile-${raw}`;
    excludeSet.add(resolveCurrent(vaultPath, candidate));
  }

  const typeFilter = opts.pokemon_type;
  const wantsTypeFilter = typeFilter.length > 0;

  const out: string[] = [];
  for (const summary of all) {
    if (excludeSet.has(summary.id)) continue;

    if (wantsTypeFilter) {
      // listProfiles surfaces pokemon_type but not secondary_pokemon_type;
      // re-read frontmatter for the secondary type check.
      let secondary: string | undefined;
      try {
        const p = readProfile(vaultPath, summary.id);
        secondary = typeof p.frontmatter.secondary_pokemon_type === "string"
          ? p.frontmatter.secondary_pokemon_type
          : undefined;
      } catch { /* skip malformed */ }

      const matches = typeFilter.includes(summary.pokemon_type) ||
                      (secondary !== undefined && typeFilter.includes(secondary));
      if (!matches) continue;
    }

    out.push(summary.id);
  }

  return out.sort();
}
