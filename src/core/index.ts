import { readFileSync, existsSync, writeFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { NoteType, PageStatus } from "./frontmatter.js";
import { parseFrontmatter } from "./frontmatter.js";
import { withSerializedIndexWrite } from "./index-locking.js";
import natural from "natural";

// Process-scoped mtime-keyed JSON cache for the `_index/` sidecars.
//
// Background: `loadIndex` and `loadTokens` are called once per tool
// dispatch by many handlers (recall, lint, list-wikis, start, merge-queue,
// merge-record, channel, etc). `tokens.json` is the largest by far — easily
// multiple MB on a mature vault — and `readFileSync` + `JSON.parse` on each
// call dominates per-call latency on platforms where syscall hooks (macOS
// EDR / antivirus, Spotlight) amplify file I/O.
//
// `upsertPage` and `reindex` both rewrite these files via `writeFileSync`,
// which bumps mtime, so an mtime+size cache key invalidates naturally with
// no explicit busting required. Cross-process consistency is preserved by
// `withSerializedIndexWrite` (writers hold a lock during the rename).
//
// Callers do not mutate the returned arrays/objects (verified across
// recall, lint, channel, list-wikis, merge-queue, merge-record, start,
// rewrite-links, resolve-trainer-context, wikis as of v0.2.2), so sharing
// cached references across calls is safe.
type CacheEntry<T> = { mtimeMs: number; size: number; data: T };
const _jsonCache = new Map<string, CacheEntry<unknown>>();

function readJsonCached<T>(path: string): T | undefined {
  let stat;
  try { stat = statSync(path); } catch { return undefined; }
  const hit = _jsonCache.get(path) as CacheEntry<T> | undefined;
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) {
    return hit.data;
  }
  const data = JSON.parse(readFileSync(path, "utf8")) as T;
  _jsonCache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, data });
  return data;
}

/**
 * Drop a cached parse for a specific file. Called by every sidecar writer
 * immediately after `writeFileSync` so a subsequent read in the same process
 * always re-parses, regardless of OS-timer-quantized mtime collisions on
 * rapid back-to-back writes (Windows is the worst offender here). Cross-process
 * consistency still relies on mtime+size, which is fine: writers hold a lock
 * during the write, and a different process's next stat sees the post-release
 * mtime.
 */
export function invalidateIndexCache(path: string): void {
  _jsonCache.delete(path);
}

/** Test-only hook: drop all cached index/token parses. */
export function _clearIndexCache(): void {
  _jsonCache.clear();
}

const KNOWLEDGE_TYPES: NoteType[] = ["concept", "spec", "decision", "synthesis", "guide", "source", "idea", "question"];
const EXECUTION_TYPES: NoteType[] = ["task", "journal"];

export interface IndexedPage {
  id: string;
  type: NoteType;
  wiki: string;
  title: string;
  summary: string;
  tags: string[];
  status: PageStatus;
  confidence?: "high" | "medium" | "low";
  channel?: string;
  updated: string;
  created: string;
  path: string;
  tokens?: { title: string[]; summary: string[]; body: string[]; tags: string[] };
}

export interface IndexedWiki {
  name: string;
  mode: string;
  scope: string;
  // Phase-2 T2-1 — surfaced from each wiki's CLAUDE.md `family:` field by
  // `core/reindex.ts` via `loadWikiMeta`. Omitted from the JSON entry when
  // the wiki declares no family (Plan B back-compat: "default to omission").
  family?: string;
  page_counts: Record<string, number>;
  last_touched: string;
}

export interface VaultIndex {
  wikis: IndexedWiki[];
  pages: IndexedPage[];
  links: Record<string, { outbound: string[]; inbound: string[] }>;
}

export function loadIndex(vaultPath: string): VaultIndex {
  const wikisPath = join(vaultPath, "_index", "wikis.json");
  const pagesPath = join(vaultPath, "_index", "pages.json");
  const linksPath = join(vaultPath, "_index", "links.json");
  const wikisDoc = readJsonCached<{ wikis?: IndexedWiki[] }>(wikisPath);
  const pagesDoc = readJsonCached<{ pages?: IndexedPage[] }>(pagesPath);
  const linksDoc = readJsonCached<VaultIndex["links"]>(linksPath);
  return {
    wikis: wikisDoc?.wikis ?? [],
    pages: pagesDoc?.pages ?? [],
    links: linksDoc ?? {},
  };
}

export interface PageTokens {
  title: string[];
  summary: string[];
  body: string[];
  tags: string[];
}

export function loadTokens(vaultPath: string): Record<string, PageTokens> {
  const path = join(vaultPath, "_index", "tokens.json");
  return readJsonCached<Record<string, PageTokens>>(path) ?? {};
}

export interface PageFilter {
  wiki?: string;
  // Phase-2 T3-2 — multi-wiki scope used by family-aware tools (recall, list-wikis,
  // start). When set, pages are kept iff their `wiki` field is in the array. The
  // single `wiki` field still wins when both are set (most-specific). Empty array
  // matches nothing.
  wikis?: string[];
  type?: NoteType;
  layer?: "knowledge" | "execution" | "all";
  channel?: string;
  status?: PageStatus;
}

export function queryPages(idx: VaultIndex, f: PageFilter): IndexedPage[] {
  const wikiSet = f.wikis ? new Set(f.wikis) : undefined;
  return idx.pages.filter(p => {
    if (f.wiki && p.wiki !== f.wiki) return false;
    if (!f.wiki && wikiSet && !wikiSet.has(p.wiki)) return false;
    if (f.type && p.type !== f.type) return false;
    if (f.channel && p.channel !== f.channel) return false;
    if (f.status && p.status !== f.status) return false;
    if (f.layer && f.layer !== "all") {
      const set = f.layer === "knowledge" ? KNOWLEDGE_TYPES : EXECUTION_TYPES;
      if (!set.includes(p.type)) return false;
    }
    return true;
  });
}

export function queryWikis(idx: VaultIndex): IndexedWiki[] {
  return idx.wikis;
}

const upsertStemmer = natural.PorterStemmer;
const UPSERT_STOP_WORDS = new Set(["the","and","of","a","an","in","to","is","for","on","with","as","at","by","or","be","this","that","it","from","are","was","were","not","but","if"]);

function upsertTokenize(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 1 && !UPSERT_STOP_WORDS.has(t))
    .map(t => upsertStemmer.stem(t));
}

/**
 * Write-through index update for a single page. Reads the file at `pagePath`,
 * parses its frontmatter, and adds/replaces the entry in `_index/pages.json`
 * and `_index/tokens.json`. Does NOT regenerate `_index/{links,wikis,profiles}.json`
 * — those are aggregated views that still need a full reindex.
 *
 * No-op (no throw) on missing file or malformed frontmatter.
 *
 * Used by `core/channel.postToChannel` and the agent-journal tool/CLI handlers
 * so newly-written entries become immediately visible to `tailChannel` and
 * `recall` without requiring callers to run `vault_reindex` first.
 */
export async function upsertPage(vaultPath: string, pagePath: string): Promise<void> {
  // v1.7 §5.2 — wrap the entire RMW across pages.json + tokens.json + wikis.json
  // in a single multi-key serialization so concurrent upserts cannot lose writes
  // and reindex (which acquires all four sidecar keys at once) cannot tear an
  // upsert across sidecars. links.json is NOT a key here — upsertPage does not
  // touch links.json (write-through deferred to v1.8 per spec §12.1).
  await withSerializedIndexWrite(vaultPath, ["pages.json", "tokens.json", "wikis.json"], () => {
    if (!existsSync(pagePath)) return;
    let frontmatter: Record<string, any>;
    let body: string;
    try {
      const raw = readFileSync(pagePath, "utf8");
      const parsed = parseFrontmatter(raw);
      frontmatter = parsed.frontmatter;
      body = parsed.body;
    } catch {
      return;
    }

    const id = String(frontmatter.id ?? "");
    if (!id) return;

    const entry = {
      id,
      type: frontmatter.type,
      wiki: String(frontmatter.wiki ?? ""),
      title: String(frontmatter.title ?? ""),
      summary: String(frontmatter.summary ?? ""),
      tags: Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : [],
      status: String(frontmatter.status ?? "draft"),
      confidence: frontmatter.confidence ? String(frontmatter.confidence) : undefined,
      channel: frontmatter.channel ? String(frontmatter.channel) : undefined,
      updated: String(frontmatter.updated ?? frontmatter.created ?? ""),
      created: String(frontmatter.created ?? ""),
      path: relative(vaultPath, pagePath).replace(/\\/g, "/")
    };

    const pagesPath = join(vaultPath, "_index", "pages.json");
    let pagesData: { pages: any[] } = { pages: [] };
    if (existsSync(pagesPath)) {
      try { pagesData = JSON.parse(readFileSync(pagesPath, "utf8")); } catch { /* skip */ }
    }
    const wasPresent = (pagesData.pages ?? []).some((p: any) => p.id === id);
    const filtered = (pagesData.pages ?? []).filter((p: any) => p.id !== id);
    filtered.push(entry);
    writeFileSync(pagesPath, JSON.stringify({ pages: filtered }, null, 2));
    invalidateIndexCache(pagesPath);

    const tokensPath = join(vaultPath, "_index", "tokens.json");
    let tokens: Record<string, any> = {};
    if (existsSync(tokensPath)) {
      try { tokens = JSON.parse(readFileSync(tokensPath, "utf8")); } catch { /* skip */ }
    }
    tokens[id] = {
      title: upsertTokenize(String(frontmatter.title ?? "")),
      summary: upsertTokenize(String(frontmatter.summary ?? "")),
      body: upsertTokenize(body),
      tags: (Array.isArray(frontmatter.tags) ? frontmatter.tags : []).map((t: string) => upsertStemmer.stem(String(t).toLowerCase()))
    };
    writeFileSync(tokensPath, JSON.stringify(tokens, null, 2));
    invalidateIndexCache(tokensPath);

    // v1.7 §5.1 — write-through for wikis.json (cheap aggregation).
    // Page-counts: increment by 1 if this id was not previously in pages.json
    // (`wasPresent` was captured above, before the same-id filter ran).
    // last_touched: max(existing, this page's updated/created).
    const wikiName = String(frontmatter.wiki ?? "");
    if (wikiName) {
      const wikisPath = join(vaultPath, "_index", "wikis.json");
      let wikisData: { wikis: any[] } = { wikis: [] };
      if (existsSync(wikisPath)) {
        try { wikisData = JSON.parse(readFileSync(wikisPath, "utf8")); } catch { /* skip */ }
      }
      const wikis = wikisData.wikis ?? [];
      let wikiEntry = wikis.find((w: any) => w.name === wikiName);
      if (!wikiEntry) {
        wikiEntry = { name: wikiName, mode: "mixed", scope: "", page_counts: {}, last_touched: "" };
        wikis.push(wikiEntry);
      }
      if (!wasPresent) {
        const t = String(frontmatter.type ?? "");
        if (t) wikiEntry.page_counts[t] = (wikiEntry.page_counts[t] ?? 0) + 1;
      }
      const ts = String(frontmatter.updated ?? frontmatter.created ?? "");
      if (ts && ts > wikiEntry.last_touched) {
        wikiEntry.last_touched = ts;
      }
      writeFileSync(wikisPath, JSON.stringify({ ...wikisData, wikis }, null, 2));
      invalidateIndexCache(wikisPath);
    }
  });
}
