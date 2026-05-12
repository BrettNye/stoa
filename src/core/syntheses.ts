// core/syntheses.ts
//
// Joins _index/pages.json (filtered to type=synthesis) against
// _index/links.json (forward `outbound` edges) to produce a staleness view
// per synthesis — `lag_days` since `last_compiled`, plus the subset of
// related pages whose `updated` is newer than `last_compiled`.
//
// `last_compiled` is stored in the synthesis file's own frontmatter, not in
// the index, so we read each synthesis file from the path recorded in
// pages.json.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter, toIsoDate } from "./frontmatter.js";

export interface SynthesisStalenessInput {
  id: string;
  updated: string;
}

export interface SynthesisStaleness {
  id: string;
  wiki: string;
  title: string;
  last_compiled: string | null;
  lag_days: number | null;
  stale_inputs: SynthesisStalenessInput[];
}

export interface ListSynthesesOptions {
  wiki?: string;
  /** Filter to syntheses whose lag_days >= this value (null lag always included). */
  min_lag_days?: number;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Reads _index/pages.json and _index/links.json from `vaultPath`, then
 * produces a staleness view for each synthesis page.
 *
 * Returns [] if either index file is missing (cold vault).
 */
export function listSynthesesWithStaleness(
  vaultPath: string,
  opts: ListSynthesesOptions = {}
): SynthesisStaleness[] {
  const pagesPath = join(vaultPath, "_index", "pages.json");
  const linksPath = join(vaultPath, "_index", "links.json");

  // Cold vault: return [] rather than throwing
  if (!existsSync(pagesPath) || !existsSync(linksPath)) {
    return [];
  }

  const pagesData = JSON.parse(readFileSync(pagesPath, "utf8")) as { pages: Array<Record<string, any>> };
  const linksData = JSON.parse(readFileSync(linksPath, "utf8")) as Record<string, { outbound: string[]; inbound: string[] }>;

  const allPages: Array<Record<string, any>> = pagesData.pages ?? [];

  // Build a lookup map for all pages by id — used to resolve outbound links
  const pageById = new Map<string, Record<string, any>>();
  for (const page of allPages) {
    pageById.set(String(page.id), page);
  }

  // Filter to synthesis pages, optionally scoped to one wiki
  const syntheses = allPages.filter(p => {
    if (p.type !== "synthesis") return false;
    if (opts.wiki && p.wiki !== opts.wiki) return false;
    return true;
  });

  const now = Date.now();

  const results: SynthesisStaleness[] = [];

  for (const synth of syntheses) {
    const synthId = String(synth.id);
    const synthPath = synth.path ? join(vaultPath, String(synth.path)) : null;

    // Read last_compiled from the synthesis file's frontmatter
    let lastCompiled: string | null = null;
    if (synthPath && existsSync(synthPath)) {
      try {
        const raw = readFileSync(synthPath, "utf8");
        const { frontmatter } = parseFrontmatter(raw);
        const rawLc = frontmatter.last_compiled;
        if (rawLc !== undefined && rawLc !== null) {
          const normalized = toIsoDate(rawLc);
          if (normalized) lastCompiled = normalized;
        }
      } catch {
        // Malformed file — treat as never compiled
      }
    }

    // Compute lag_days
    let lagDays: number | null = null;
    if (lastCompiled) {
      const compiledMs = new Date(lastCompiled).getTime();
      lagDays = Math.floor((now - compiledMs) / MS_PER_DAY);
    }

    // Apply min_lag_days filter: null-lag entries are always retained
    if (opts.min_lag_days !== undefined && lagDays !== null && lagDays < opts.min_lag_days) {
      continue;
    }

    // Collect stale inputs from outbound links
    const linksEntry = linksData[synthId];
    const outbound: string[] = linksEntry?.outbound ?? [];

    const staleInputs: SynthesisStalenessInput[] = [];
    for (const linkedId of outbound) {
      const linkedPage = pageById.get(linkedId);
      if (!linkedPage) continue;
      const linkedUpdated = String(linkedPage.updated ?? "");
      if (!linkedUpdated) continue;

      if (lastCompiled === null) {
        // Never compiled → every related page with a defined updated is stale
        staleInputs.push({ id: linkedId, updated: linkedUpdated });
      } else {
        // Strictly greater-than comparison (string comparison works for ISO dates)
        if (linkedUpdated > lastCompiled) {
          staleInputs.push({ id: linkedId, updated: linkedUpdated });
        }
      }
    }

    results.push({
      id: synthId,
      wiki: String(synth.wiki ?? ""),
      title: String(synth.title ?? ""),
      last_compiled: lastCompiled,
      lag_days: lagDays,
      stale_inputs: staleInputs,
    });
  }

  // Sort: null lag (never compiled) first, then descending lag_days
  results.sort((a, b) => {
    if (a.lag_days === null && b.lag_days === null) return 0;
    if (a.lag_days === null) return -1; // null sorts before any number
    if (b.lag_days === null) return 1;
    return b.lag_days - a.lag_days; // descending (most stale first)
  });

  return results;
}
