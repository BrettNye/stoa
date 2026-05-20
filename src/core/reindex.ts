import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import natural from "natural";
import { parseFrontmatter, toIsoDate } from "./frontmatter.js";
import { invalidateIndexCache } from "./index.js";
import type { IndexedPage, IndexedWiki, PageTokens } from "./index.js";
import { listProfiles } from "./profiles.js";
import { readAliases } from "./aliases.js";
import { loadWikiMeta } from "./wikis.js";
import { aggregateFamilies } from "./family.js";
import { withSerializedIndexWrite } from "./index-locking.js";
import { buildClaimsIndex, writeClaimsIndex } from "./claims-index.js";

/**
 * Phase-2 T2-2 — converts the IndexedWiki[] array (current `_index/wikis.json`
 * shape) into the `Record<string, { name, mode, family?, page_count? }>` shape
 * `aggregateFamilies` expects. `page_count` is the sum of all entries in each
 * wiki's `page_counts` (per-type) map. We intentionally keep the on-disk
 * `wikis: [...]` array shape — only the new top-level `families: {...}` rollup
 * is added. Migrating wikis to a map is a separate breaking change.
 */
function summariesToFamilyInput(
  wikis: IndexedWiki[]
): Record<string, { name: string; mode: string; family?: string; page_count: number }> {
  const out: Record<string, { name: string; mode: string; family?: string; page_count: number }> = {};
  for (const w of wikis) {
    const page_count = Object.values(w.page_counts ?? {}).reduce((a, b) => a + b, 0);
    out[w.name] = {
      name: w.name,
      mode: w.mode,
      ...(w.family ? { family: w.family } : {}),
      page_count,
    };
  }
  return out;
}

const stemmer = natural.PorterStemmer;
const STOP_WORDS = new Set(["the","and","of","a","an","in","to","is","for","on","with","as","at","by","or","be","this","that","it","from","are","was","were","not","but","if"]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t))
    .map(t => stemmer.stem(t));
}

function extractWikilinks(body: string): string[] {
  const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  const out: string[] = [];
  let m;
  while ((m = re.exec(body)) !== null) {
    const target = m[1].trim();
    const lastSlash = target.lastIndexOf("/");
    out.push(lastSlash === -1 ? target : target.slice(lastSlash + 1));
  }
  return out;
}

const TYPE_FOLDERS = ["concepts","guides","decisions","specs","synthesis","ideas","questions","sources","journal","tasks","profiles","plans"];

function discoverPages(vaultPath: string, wiki: string): IndexedPage[] {
  const pages: IndexedPage[] = [];
  const wikiDir = join(vaultPath, "wikis", wiki);
  if (!existsSync(wikiDir)) return pages;
  // map.md
  const mapPath = join(wikiDir, "map.md");
  if (existsSync(mapPath)) {
    try {
      const { frontmatter, body } = parseFrontmatter(readFileSync(mapPath, "utf8"));
      pages.push(buildIndexedPage(frontmatter, body, mapPath, vaultPath));
    } catch { /* skip malformed map */ }
  }
  for (const folder of TYPE_FOLDERS) {
    const dir = join(wikiDir, folder);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".md")) continue;
      const p = join(dir, file);
      try {
        const { frontmatter, body } = parseFrontmatter(readFileSync(p, "utf8"));
        pages.push(buildIndexedPage(frontmatter, body, p, vaultPath));
      } catch { /* skip malformed */ }
    }
  }
  // v1.5 — moves use a directory layout: moves/<move-id>/SKILL.md
  const movesDir = join(wikiDir, "moves");
  if (existsSync(movesDir)) {
    for (const entry of readdirSync(movesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillPath = join(movesDir, entry.name, "SKILL.md");
      if (!existsSync(skillPath)) continue;
      try {
        const { frontmatter, body } = parseFrontmatter(readFileSync(skillPath, "utf8"));
        pages.push(buildIndexedPage(frontmatter, body, skillPath, vaultPath));
      } catch { /* skip malformed */ }
    }
  }
  return pages;
}

function buildIndexedPage(fm: any, body: string, path: string, vaultPath: string): IndexedPage {
  const wikilinks = extractWikilinks(body);
  const fmRelated = (fm.related ?? []).map((r: string) => {
    const m = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/.exec(r);
    if (!m) return r;
    const t = m[1].trim();
    const i = t.lastIndexOf("/");
    return i === -1 ? t : t.slice(i + 1);
  });
  return {
    id: fm.id,
    type: fm.type,
    wiki: fm.wiki,
    title: fm.title ?? "",
    summary: fm.summary ?? "",
    tags: fm.tags ?? [],
    status: fm.status ?? "draft",
    confidence: fm.confidence,
    channel: fm.channel,
    updated: toIsoDate(fm.updated ?? fm.created),
    created: toIsoDate(fm.created),
    path: relative(vaultPath, path).replace(/\\/g, "/"),
    tokens: {
      title: tokenize(fm.title ?? ""),
      summary: tokenize(fm.summary ?? ""),
      body: tokenize(body),
      tags: (fm.tags ?? []).map((t: string) => stemmer.stem(t.toLowerCase()))
    },
    // Hidden field used during link build
    __outbound: [...new Set([...fmRelated, ...wikilinks])]
  } as any;
}

// Wikis whose names start with `_` are reserved/system. Most are skipped from
// reindex (e.g. _archive, _agent_scratch). `_meta` and `_agents` are the
// exceptions: vault-meta docs (schema spec, MCP design spec, plans) and the
// v1.5 agent substrate (profiles, moves, journals, tasks) must be queryable
// via /recall, so we include them.
const RESERVED_INCLUDED = new Set(["_meta", "_agents"]);

function discoverWikis(vaultPath: string): string[] {
  const wikisDir = join(vaultPath, "wikis");
  if (!existsSync(wikisDir)) return [];
  return readdirSync(wikisDir)
    .filter(name => !name.startsWith("_") || RESERVED_INCLUDED.has(name))
    .filter(name => statSync(join(wikisDir, name)).isDirectory());
}

export interface ReindexResult {
  pages_indexed: number;
  wikis_indexed: number;
  links_indexed: number;
  duration_ms: number;
}

export async function reindex(vaultPath: string, scopeWiki?: string): Promise<ReindexResult> {
  const start = Date.now();
  if (!scopeWiki) {
    return reindexFull(vaultPath, start);
  }
  return reindexScoped(vaultPath, scopeWiki, start);
}

/**
 * v1.6.2 — scoped reindex must merge with existing index instead of replacing.
 * Pre-fix, this path overwrote all four sidecars with only scopeWiki's payload,
 * wiping every other wiki from the index. Now: load existing sidecars, drop the
 * scope wiki's existing entries, splice in fresh scope payload, write.
 *
 * Reserved-wiki guard mirrors discoverWikis: scoped reindex of `_*` is rejected
 * unless in RESERVED_INCLUDED, so scoped and unscoped agree on which wikis can
 * appear in the index.
 *
 * Missing-sidecar fallback: if any of the four sidecars is missing or
 * unparseable, fall back to a full reindex — there's nothing to merge into.
 */
function reindexScoped(vaultPath: string, scopeWiki: string, start: number): Promise<ReindexResult> {
  if (scopeWiki.startsWith("_") && !RESERVED_INCLUDED.has(scopeWiki)) {
    throw new Error(`Cannot reindex reserved wiki: ${scopeWiki}`);
  }

  return withSerializedIndexWrite(
    vaultPath,
    ["claims.json", "pages.json", "tokens.json", "wikis.json", "links.json"],
    async () => {
      const existing = loadExistingIndex(vaultPath);
      if (!existing) {
        // Missing-sidecar fallback: rebuild from scratch under the same lock
        // we already hold (re-entry via reindexFull would deadlock).
        return await reindexFullBody(vaultPath, start);
      }

      const newScopePages = discoverPages(vaultPath, scopeWiki);
      const oldScopeIds = new Set(
        existing.pages.filter((p: any) => p.wiki === scopeWiki).map((p: any) => p.id)
      );

      const sanitizedFresh = newScopePages.map(p => {
        const { __outbound, tokens, ...rest } = p as any;
        return rest;
      });
      const combinedPages = mergePagesByWiki(existing.pages, scopeWiki, sanitizedFresh);

      const tokensMap = mergeTokens(existing.tokens, oldScopeIds, newScopePages);

      const counts: Record<string, number> = {};
      for (const p of newScopePages) counts[p.type] = (counts[p.type] ?? 0) + 1;
      const lastTouched = newScopePages.map(p => p.updated).sort().reverse()[0] ?? "";
      const meta = loadWikiMeta(vaultPath, scopeWiki);
      const freshSummary: IndexedWiki = {
        name: scopeWiki,
        // v1.7 §5.7 — read mode from each wiki's CLAUDE.md. Fallback to
        // "mixed" preserves old behavior when CLAUDE.md is absent.
        mode: meta.mode ?? "mixed",
        scope: "",
        page_counts: counts,
        last_touched: lastTouched
      };
      if (meta.family) freshSummary.family = meta.family;
      const combinedSummaries = mergeWikiSummaries(existing.wikis, scopeWiki, freshSummary);
      const families = aggregateFamilies(summariesToFamilyInput(combinedSummaries));

      const scopeOutbound: Record<string, string[]> = {};
      for (const p of newScopePages) {
        scopeOutbound[p.id] = ((p as any).__outbound ?? []) as string[];
      }
      const links = rebuildLinks(combinedPages, existing.links, scopeOutbound);

      const wikisPathScoped = join(vaultPath, "_index", "wikis.json");
      const pagesPathScoped = join(vaultPath, "_index", "pages.json");
      const tokensPathScoped = join(vaultPath, "_index", "tokens.json");
      const linksPathScoped = join(vaultPath, "_index", "links.json");
      writeFileSync(wikisPathScoped, JSON.stringify({ wikis: combinedSummaries, families }, null, 2));
      invalidateIndexCache(wikisPathScoped);
      writeFileSync(pagesPathScoped, JSON.stringify({ pages: combinedPages }, null, 2));
      invalidateIndexCache(pagesPathScoped);
      writeFileSync(tokensPathScoped, JSON.stringify(tokensMap, null, 2));
      invalidateIndexCache(tokensPathScoped);
      writeFileSync(linksPathScoped, JSON.stringify(links, null, 2));
      invalidateIndexCache(linksPathScoped);

      writeProfilesJson(vaultPath);
      ensureAliasesJson(vaultPath);

      // Claims sidecar — Plan 1 §task-reindex-claims-integration. The sidecar
      // is built from a full disk scan over every wiki's `claim/` folder
      // (see `buildClaimsIndex`), so scoped reindex still produces a complete
      // picture rather than a wiki-local subset. The `claims.json` lock is
      // acquired alongside the four core sidecar locks above.
      const claimsIdx = await buildClaimsIndex(vaultPath);
      await writeClaimsIndex(vaultPath, claimsIdx);

      return {
        pages_indexed: combinedPages.length,
        wikis_indexed: combinedSummaries.length,
        links_indexed: Object.keys(links).length,
        duration_ms: Date.now() - start
      };
    }
  );
}

interface ExistingIndex {
  pages: any[];
  tokens: Record<string, PageTokens>;
  links: Record<string, { outbound: string[]; inbound: string[] }>;
  wikis: IndexedWiki[];
}

function loadExistingIndex(vaultPath: string): ExistingIndex | null {
  const indexDir = join(vaultPath, "_index");
  const pagesPath = join(indexDir, "pages.json");
  const tokensPath = join(indexDir, "tokens.json");
  const linksPath = join(indexDir, "links.json");
  const wikisPath = join(indexDir, "wikis.json");
  if (
    !existsSync(pagesPath) ||
    !existsSync(tokensPath) ||
    !existsSync(linksPath) ||
    !existsSync(wikisPath)
  ) {
    return null;
  }
  try {
    const pages = (JSON.parse(readFileSync(pagesPath, "utf8")).pages ?? []) as any[];
    const tokens = JSON.parse(readFileSync(tokensPath, "utf8")) as Record<string, PageTokens>;
    const links = JSON.parse(readFileSync(linksPath, "utf8")) as Record<
      string,
      { outbound: string[]; inbound: string[] }
    >;
    const wikis = (JSON.parse(readFileSync(wikisPath, "utf8")).wikis ?? []) as IndexedWiki[];
    return { pages, tokens, links, wikis };
  } catch {
    return null;
  }
}

function mergePagesByWiki(existingPages: any[], scopeWiki: string, freshScopeSanitized: any[]): any[] {
  const nonScope = existingPages.filter(p => p.wiki !== scopeWiki);
  return nonScope.concat(freshScopeSanitized);
}

function mergeTokens(
  existingTokens: Record<string, PageTokens>,
  oldScopeIds: Set<string>,
  freshScopePages: IndexedPage[]
): Record<string, PageTokens> {
  const out: Record<string, PageTokens> = {};
  for (const [id, tok] of Object.entries(existingTokens)) {
    if (!oldScopeIds.has(id)) out[id] = tok;
  }
  for (const p of freshScopePages) {
    if (p.tokens) out[p.id] = p.tokens;
  }
  return out;
}

function mergeWikiSummaries(
  existingSummaries: IndexedWiki[],
  scopeWiki: string,
  freshSummary: IndexedWiki
): IndexedWiki[] {
  return existingSummaries.filter(w => w.name !== scopeWiki).concat([freshSummary]);
}

/**
 * Scoped link rebuild — combines outbound from existing non-scope pages
 * (carried forward from oldLinks) with fresh scope pages' outbound, then
 * rebuilds inbound from scratch. Skips dangling targets so deleted scope
 * pages don't retain stale inbound entries from non-scope pages still
 * referencing them. (Diverges intentionally from reindexFull, which currently
 * creates dangling entries; aligning the two paths is a v1.7 candidate.)
 */
function rebuildLinks(
  combinedPages: any[],
  oldLinks: Record<string, { outbound: string[]; inbound: string[] }>,
  scopeOutbound: Record<string, string[]>
): Record<string, { outbound: string[]; inbound: string[] }> {
  const outboundOf: Record<string, string[]> = {};
  for (const p of combinedPages) {
    if (p.id in scopeOutbound) {
      outboundOf[p.id] = scopeOutbound[p.id];
    } else {
      outboundOf[p.id] = oldLinks[p.id]?.outbound ?? [];
    }
  }
  const idSet = new Set(combinedPages.map(p => p.id));
  const links: Record<string, { outbound: string[]; inbound: string[] }> = {};
  for (const p of combinedPages) {
    links[p.id] = { outbound: outboundOf[p.id], inbound: [] };
  }
  for (const p of combinedPages) {
    for (const target of outboundOf[p.id]) {
      if (!idSet.has(target)) continue;
      if (!links[target].inbound.includes(p.id)) {
        links[target].inbound.push(p.id);
      }
    }
  }
  return links;
}

function reindexFull(vaultPath: string, start: number): Promise<ReindexResult> {
  return withSerializedIndexWrite(
    vaultPath,
    ["claims.json", "pages.json", "tokens.json", "wikis.json", "links.json"],
    () => reindexFullBody(vaultPath, start)
  );
}

/**
 * v1.7 §5.3 — pure body of `reindexFull`, extracted so `reindexScoped`'s
 * missing-sidecar fallback can re-use it without re-entering the lock.
 * Callers MUST hold all five sidecar locks (pages.json, tokens.json,
 * wikis.json, links.json, claims.json) before invoking.
 *
 * Plan 1 §task-reindex-claims-integration — claims.json is now built and
 * persisted alongside the core four sidecars. `buildClaimsIndex` walks the
 * disk itself (not `allPages`), so the claims sidecar is independent of the
 * page-discovery flow above.
 */
async function reindexFullBody(vaultPath: string, start: number): Promise<ReindexResult> {
  const wikis = discoverWikis(vaultPath);
  const allPages: IndexedPage[] = [];
  const wikiSummaries: IndexedWiki[] = [];

  for (const w of wikis) {
    const pages = discoverPages(vaultPath, w);
    allPages.push(...pages);
    const counts: Record<string, number> = {};
    for (const p of pages) counts[p.type] = (counts[p.type] ?? 0) + 1;
    const lastTouched = pages.map(p => p.updated).sort().reverse()[0] ?? "";
    // Phase-2 T2-1 — surface `family:` from `wikis/<w>/CLAUDE.md` onto the
    // index entry. Default to omission when absent (Plan B back-compat).
    // v1.7 §5.7 — `mode:` is now also read from CLAUDE.md (was hardcoded
    // to "mixed" pre-v1.7). Fallback to "mixed" when CLAUDE.md is absent
    // or has no `mode:` line preserves the old behavior.
    const meta = loadWikiMeta(vaultPath, w);
    const summary: IndexedWiki = {
      name: w,
      mode: meta.mode ?? "mixed",
      scope: "",
      page_counts: counts,
      last_touched: lastTouched
    };
    if (meta.family) summary.family = meta.family;
    wikiSummaries.push(summary);
  }

  // Build links: forward + inbound. v1.7 §5.5 — skip dangling targets so
  // reindexFull aligns with reindexScoped's existing behavior. A link to a
  // nonexistent target does not create an entry in links.json. Forward edges
  // for the writer still record the full outbound list (including dangling
  // targets, mirroring reindexScoped's rebuildLinks); only the inbound /
  // cross-reference side filters dangling.
  const knownPageIds = new Set(allPages.map(p => p.id));
  const links: Record<string, { outbound: string[]; inbound: string[] }> = {};
  for (const p of allPages) {
    if (!links[p.id]) links[p.id] = { outbound: [], inbound: [] };
    const outbound: string[] = (p as any).__outbound ?? [];
    links[p.id].outbound = outbound;
    for (const target of outbound) {
      if (!knownPageIds.has(target)) continue;  // skip dangling
      if (!links[target]) links[target] = { outbound: [], inbound: [] };
      if (!links[target].inbound.includes(p.id)) links[target].inbound.push(p.id);
    }
  }

  // Build tokens sidecar map keyed by page id
  const tokensMap: Record<string, PageTokens> = {};
  for (const p of allPages) {
    if (p.tokens) tokensMap[p.id] = p.tokens;
  }

  // Strip hidden fields and tokens before write — tokens live in tokens.json
  const sanitized = allPages.map(p => {
    const { __outbound, tokens, ...rest } = p as any;
    return rest;
  });

  // Phase-2 T2-2 — emit a top-level `families:` rollup alongside the existing
  // `wikis: [...]` array. Plan B locks: when no wiki declares a family, write
  // `families: {}` (empty object, always present) for shape stability. The
  // wikis array shape is intentionally unchanged — array → map is a separate
  // breaking change.
  const families = aggregateFamilies(summariesToFamilyInput(wikiSummaries));
  const wikisPathFull = join(vaultPath, "_index", "wikis.json");
  const pagesPathFull = join(vaultPath, "_index", "pages.json");
  const tokensPathFull = join(vaultPath, "_index", "tokens.json");
  const linksPathFull = join(vaultPath, "_index", "links.json");
  writeFileSync(wikisPathFull, JSON.stringify({ wikis: wikiSummaries, families }, null, 2));
  invalidateIndexCache(wikisPathFull);
  writeFileSync(pagesPathFull, JSON.stringify({ pages: sanitized }, null, 2));
  invalidateIndexCache(pagesPathFull);
  writeFileSync(tokensPathFull, JSON.stringify(tokensMap, null, 2));
  invalidateIndexCache(tokensPathFull);
  writeFileSync(linksPathFull, JSON.stringify(links, null, 2));
  invalidateIndexCache(linksPathFull);

  writeProfilesJson(vaultPath);
  ensureAliasesJson(vaultPath);

  // Plan 1 §task-reindex-claims-integration — emit `_index/claims.json`. Built
  // from a full disk walk over `wikis/<wiki>/claim/*.md`; only `status: "active"`
  // claims are bucketed (see `buildClaimsIndex` for the rules). An empty vault
  // emits a sidecar with the full canonical shape and empty buckets — never a
  // missing file, so downstream consumers can rely on it always being present
  // after a reindex.
  const claimsIdx = await buildClaimsIndex(vaultPath);
  await writeClaimsIndex(vaultPath, claimsIdx);

  return {
    pages_indexed: allPages.length,
    wikis_indexed: wikiSummaries.length,
    links_indexed: Object.keys(links).length,
    duration_ms: Date.now() - start
  };
}

export interface ProfileStatsRow {
  id: string;
  pokemon_type: string;
  evolution_stage: string;
  moveset: string[];
  tasks_completed: number;
  tasks_failed: number;
  tasks_in_flight: number;
  journals_count: number;
  channels_active: string[];
  moves_used_freq: Record<string, number>;
  days_since_creation: number;
  last_active?: string;
}

function writeProfilesJson(vaultPath: string): void {
  const profiles = listProfiles(vaultPath);
  const out: Record<string, ProfileStatsRow> = {};

  for (const p of profiles) {
    out[p.id] = {
      id: p.id,
      pokemon_type: p.pokemon_type,
      evolution_stage: p.evolution_stage,
      moveset: p.moveset,
      tasks_completed: countTasksForAgent(vaultPath, p.id, "completed"),
      tasks_failed: countTasksForAgent(vaultPath, p.id, "failed"),
      tasks_in_flight: countTasksForAgent(vaultPath, p.id, "in_progress")
        + countTasksForAgent(vaultPath, p.id, "claimed"),
      journals_count: countJournalsForAgent(vaultPath, p.id),
      channels_active: channelsForAgent(vaultPath, p.id),
      moves_used_freq: movesUsedFreq(vaultPath, p.id),
      days_since_creation: 0  // computed by profile-stats tool from frontmatter.created
    };
  }

  const path = join(vaultPath, "_index", "profiles.json");
  writeFileSync(path, JSON.stringify(out, null, 2));
}

function ensureAliasesJson(vaultPath: string): void {
  const path = join(vaultPath, "_index", "aliases.json");
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify({}, null, 2));
  }
}

function countTasksForAgent(vaultPath: string, profile_id: string, status: string): number {
  const aliases = readAliases(vaultPath);
  const allIds = new Set([profile_id]);
  if (aliases[profile_id]) {
    for (const h of aliases[profile_id].history) allIds.add(h);
  }
  for (const [orig, entry] of Object.entries(aliases)) {
    if (entry.current === profile_id) {
      allIds.add(orig);
      for (const h of entry.history) allIds.add(h);
    }
  }
  const agentRefs = new Set([...allIds].map(id =>
    `agent:${id.startsWith("profile-") ? id.slice("profile-".length) : id}`
  ));

  const wikisDir = join(vaultPath, "wikis");
  if (!existsSync(wikisDir)) return 0;
  let count = 0;
  for (const wiki of readdirSync(wikisDir, { withFileTypes: true }).filter(d => d.isDirectory())) {
    const tasksDir = join(wikisDir, wiki.name, "tasks");
    if (!existsSync(tasksDir)) continue;
    for (const file of readdirSync(tasksDir)) {
      if (!file.endsWith(".md")) continue;
      try {
        const raw = readFileSync(join(tasksDir, file), "utf8");
        const { frontmatter: fm } = parseFrontmatter(raw);
        if (fm.status === status && fm.claimed_by && agentRefs.has(String(fm.claimed_by))) {
          count++;
        }
      } catch { /* skip */ }
    }
  }
  return count;
}

function countJournalsForAgent(vaultPath: string, profile_id: string): number {
  const aliases = readAliases(vaultPath);
  const allIds = new Set([profile_id]);
  if (aliases[profile_id]) for (const h of aliases[profile_id].history) allIds.add(h);
  for (const [orig, entry] of Object.entries(aliases)) {
    if (entry.current === profile_id) {
      allIds.add(orig);
      for (const h of entry.history) allIds.add(h);
    }
  }
  const agentRefs = new Set([...allIds].map(id =>
    `agent:${id.startsWith("profile-") ? id.slice("profile-".length) : id}`
  ));

  const wikisDir = join(vaultPath, "wikis");
  if (!existsSync(wikisDir)) return 0;
  let count = 0;
  for (const wiki of readdirSync(wikisDir, { withFileTypes: true }).filter(d => d.isDirectory())) {
    const journalDir = join(wikisDir, wiki.name, "journal");
    if (!existsSync(journalDir)) continue;
    for (const file of readdirSync(journalDir)) {
      if (!file.endsWith(".md")) continue;
      try {
        const raw = readFileSync(join(journalDir, file), "utf8");
        const { frontmatter: fm } = parseFrontmatter(raw);
        if (fm.author && agentRefs.has(String(fm.author))) count++;
      } catch { /* skip */ }
    }
  }
  return count;
}

function channelsForAgent(vaultPath: string, profile_id: string): string[] {
  // Channels touched by this agent's journals
  const aliases = readAliases(vaultPath);
  const allIds = new Set([profile_id]);
  if (aliases[profile_id]) for (const h of aliases[profile_id].history) allIds.add(h);
  for (const [orig, entry] of Object.entries(aliases)) {
    if (entry.current === profile_id) {
      allIds.add(orig);
      for (const h of entry.history) allIds.add(h);
    }
  }
  const agentRefs = new Set([...allIds].map(id =>
    `agent:${id.startsWith("profile-") ? id.slice("profile-".length) : id}`
  ));

  const channels = new Set<string>();
  const wikisDir = join(vaultPath, "wikis");
  if (!existsSync(wikisDir)) return [];
  for (const wiki of readdirSync(wikisDir, { withFileTypes: true }).filter(d => d.isDirectory())) {
    const journalDir = join(wikisDir, wiki.name, "journal");
    if (!existsSync(journalDir)) continue;
    for (const file of readdirSync(journalDir)) {
      if (!file.endsWith(".md")) continue;
      try {
        const raw = readFileSync(join(journalDir, file), "utf8");
        const { frontmatter: fm } = parseFrontmatter(raw);
        if (fm.author && agentRefs.has(String(fm.author)) && fm.channel) {
          channels.add(String(fm.channel));
        }
      } catch { /* skip */ }
    }
  }
  return [...channels];
}

function movesUsedFreq(vaultPath: string, profile_id: string): Record<string, number> {
  const aliases = readAliases(vaultPath);
  const allIds = new Set([profile_id]);
  if (aliases[profile_id]) for (const h of aliases[profile_id].history) allIds.add(h);
  for (const [orig, entry] of Object.entries(aliases)) {
    if (entry.current === profile_id) {
      allIds.add(orig);
      for (const h of entry.history) allIds.add(h);
    }
  }
  const agentRefs = new Set([...allIds].map(id =>
    `agent:${id.startsWith("profile-") ? id.slice("profile-".length) : id}`
  ));

  const freq: Record<string, number> = {};
  const wikisDir = join(vaultPath, "wikis");
  if (!existsSync(wikisDir)) return freq;
  for (const wiki of readdirSync(wikisDir, { withFileTypes: true }).filter(d => d.isDirectory())) {
    const journalDir = join(wikisDir, wiki.name, "journal");
    if (!existsSync(journalDir)) continue;
    for (const file of readdirSync(journalDir)) {
      if (!file.endsWith(".md")) continue;
      try {
        const raw = readFileSync(join(journalDir, file), "utf8");
        const { frontmatter: fm } = parseFrontmatter(raw);
        if (fm.author && agentRefs.has(String(fm.author)) && Array.isArray(fm.moves_used)) {
          for (const m of fm.moves_used) {
            freq[String(m)] = (freq[String(m)] ?? 0) + 1;
          }
        }
      } catch { /* skip */ }
    }
  }
  return freq;
}
