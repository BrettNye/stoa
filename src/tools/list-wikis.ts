// vault-mcp/src/tools/list-wikis.ts
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { listWikis } from "../core/wikis.js";
import { loadIndex, type IndexedWiki } from "../core/index.js";
import { findOnDisk } from "../core/disk-fallback.js";

const Input = z.object({
  include_reserved: z.boolean().default(false),
  // Phase-2 T3-3 — when set, output is filtered to wikis whose `family`
  // field equals this value. Combines with `group_by_family` to narrow
  // the rollup to a single family entry.
  family: z.string().optional(),
  // Phase-2 T3-3 — when true, output shape switches from a flat
  // `{ wikis: WikiSummary[] }` to `{ families: [...], unfamilied: [...] }`
  // per spec §6.3. Default false preserves v1.5 shape (regression-locked).
  group_by_family: z.boolean().default(false)
});

export interface FamilyGroup {
  name: string;
  members: IndexedWiki[];
  total_pages: number;
}

interface FamilyRollupEntry {
  members: string[];
  total_pages: number;
  modes_used: string[];
}

/**
 * Reads the `families:` rollup that `core/reindex.ts` writes alongside the
 * `wikis: [...]` array in `_index/wikis.json`. Returns an empty object when
 * the file is missing or malformed (e.g., a vault where reindex hasn't run
 * since Phase-2 T2-2 landed).
 */
function loadFamiliesRollup(vaultPath: string): Record<string, FamilyRollupEntry> {
  const path = join(vaultPath, "_index", "wikis.json");
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return raw.families ?? {};
  } catch {
    return {};
  }
}

/**
 * v1.7 §5.4 — disk-fallback augmentation for `page_counts`. Walks every
 * `wikis/<wiki>/<type-folder>/<id>.md` and records pages absent from
 * `_index/pages.json`, validating each via `findOnDisk` (which guards against
 * id-mismatch). Returns a map of `wiki -> { type -> count }` for the
 * disk-only surplus. Index-first preserved — the indexed counts come from
 * `IndexedWiki.page_counts`; this only adds the surplus on top.
 */
const TYPE_FOLDERS_FOR_COUNT = [
  "concepts", "guides", "decisions", "specs", "synthesis",
  "ideas", "questions", "sources", "journal", "tasks",
  "profiles", "plans"
] as const;

const FOLDER_TO_TYPE: Record<string, string> = {
  concepts: "concept", guides: "guide", decisions: "decision",
  specs: "spec", synthesis: "synthesis", ideas: "idea",
  questions: "question", sources: "source", journal: "journal",
  tasks: "task", profiles: "profile", plans: "plan"
};

function diskOnlyPageCounts(
  vaultPath: string,
  indexedIds: Set<string>
): Record<string, Record<string, number>> {
  const wikisDir = join(vaultPath, "wikis");
  if (!existsSync(wikisDir)) return {};
  const out: Record<string, Record<string, number>> = {};
  for (const wiki of readdirSync(wikisDir)) {
    const wikiDir = join(wikisDir, wiki);
    for (const folder of TYPE_FOLDERS_FOR_COUNT) {
      const dir = join(wikiDir, folder);
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".md")) continue;
        const id = file.replace(/\.md$/, "");
        if (indexedIds.has(id)) continue;
        const verified = findOnDisk(vaultPath, id);
        if (!verified) continue;
        if (verified.wiki !== wiki) continue;
        const type = FOLDER_TO_TYPE[folder] ?? folder;
        if (!out[wiki]) out[wiki] = {};
        out[wiki][type] = (out[wiki][type] ?? 0) + 1;
      }
    }
  }
  return out;
}

export const listWikisTool = {
  name: "vault.list-wikis",
  description: "List all visible wikis (always includes _agents; pass include_reserved for _archive etc.). Optional family: filters to one family; group_by_family: returns a rollup shape.",
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>, ctx: { vaultPath: string }) => {
    const all = listWikis(ctx.vaultPath, { include_reserved: input.include_reserved });

    // v1.7 §5.4 — augment each wiki's `page_counts` with on-disk-only pages.
    // The index-derived counts come from `IndexedWiki.page_counts` (fast
    // path); the disk scan adds entries authored on disk between reindexes.
    const idx = loadIndex(ctx.vaultPath);
    const indexedIds = new Set(idx.pages.map(p => p.id));
    const surplus = diskOnlyPageCounts(ctx.vaultPath, indexedIds);
    for (const w of all) {
      const extra = surplus[w.name];
      if (!extra) continue;
      const merged: Record<string, number> = { ...w.page_counts };
      for (const [type, n] of Object.entries(extra)) {
        merged[type] = (merged[type] ?? 0) + n;
      }
      w.page_counts = merged;
    }

    // Apply optional family filter first (narrows the working set for both
    // shapes below).
    const filtered = input.family
      ? all.filter(w => w.family === input.family)
      : all;

    if (!input.group_by_family) {
      // Default v1.5 shape — regression-locked.
      return { wikis: filtered };
    }

    // Grouped shape. Reuse `_index/wikis.json`'s `families:` rollup (from
    // T2-2) so we don't recompute total_pages / member ordering. Hydrate
    // each family's members from the filtered IndexedWiki[] working set.
    const rollup = loadFamiliesRollup(ctx.vaultPath);
    const wikiByName = new Map<string, IndexedWiki>();
    for (const w of filtered) wikiByName.set(w.name, w);

    const families: FamilyGroup[] = [];
    for (const [famName, entry] of Object.entries(rollup)) {
      // Family filter narrows the rollup to a single entry.
      if (input.family && famName !== input.family) continue;

      // Hydrate members from the filtered set; if the underlying wiki
      // isn't visible (e.g., reserved + include_reserved=false), drop it
      // from the family's members but keep the family entry.
      const members: IndexedWiki[] = [];
      for (const memberName of entry.members) {
        const hydrated = wikiByName.get(memberName);
        if (hydrated) members.push(hydrated);
      }
      families.push({
        name: famName,
        members,
        total_pages: entry.total_pages
      });
    }

    // Unfamilied = filtered wikis with no family field. When `family:` is
    // also set, unfamilied is empty by construction (the filter excluded
    // all family-less wikis already).
    const unfamilied: IndexedWiki[] = filtered.filter(w => !w.family);

    return { families, unfamilied };
  }
};
