import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import natural from "natural";
import { parseFrontmatter, toIsoDate } from "./frontmatter.js";
import type { IndexedPage, IndexedWiki, PageTokens } from "./index.js";
import { listProfiles } from "./profiles.js";
import { readAliases } from "./aliases.js";

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

const TYPE_FOLDERS = ["concepts","guides","decisions","specs","synthesis","ideas","questions","sources","journal","tasks","profiles"];

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

export function reindex(vaultPath: string, scopeWiki?: string): ReindexResult {
  const start = Date.now();
  const wikis = scopeWiki ? [scopeWiki] : discoverWikis(vaultPath);
  const allPages: IndexedPage[] = [];
  const wikiSummaries: IndexedWiki[] = [];

  for (const w of wikis) {
    const pages = discoverPages(vaultPath, w);
    allPages.push(...pages);
    const counts: Record<string, number> = {};
    for (const p of pages) counts[p.type] = (counts[p.type] ?? 0) + 1;
    const lastTouched = pages.map(p => p.updated).sort().reverse()[0] ?? "";
    wikiSummaries.push({
      name: w,
      mode: "mixed", // TODO read from wiki CLAUDE.md in v1.5
      scope: "",
      page_counts: counts,
      last_touched: lastTouched
    });
  }

  // Build links: forward + inbound
  const links: Record<string, { outbound: string[]; inbound: string[] }> = {};
  for (const p of allPages) {
    links[p.id] = links[p.id] ?? { outbound: [], inbound: [] };
    const outbound: string[] = (p as any).__outbound ?? [];
    links[p.id].outbound = outbound;
    for (const target of outbound) {
      links[target] = links[target] ?? { outbound: [], inbound: [] };
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

  writeFileSync(join(vaultPath, "_index", "wikis.json"), JSON.stringify({ wikis: wikiSummaries }, null, 2));
  writeFileSync(join(vaultPath, "_index", "pages.json"), JSON.stringify({ pages: sanitized }, null, 2));
  writeFileSync(join(vaultPath, "_index", "tokens.json"), JSON.stringify(tokensMap, null, 2));
  writeFileSync(join(vaultPath, "_index", "links.json"), JSON.stringify(links, null, 2));

  writeProfilesJson(vaultPath);
  ensureAliasesJson(vaultPath);

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
