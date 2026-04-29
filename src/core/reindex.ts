import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import natural from "natural";
import { parseFrontmatter, toIsoDate } from "./frontmatter.js";
import type { IndexedPage, IndexedWiki, PageTokens } from "./index.js";

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

const TYPE_FOLDERS = ["concepts","guides","decisions","specs","synthesis","ideas","questions","sources","journal","tasks"];

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
// reindex (e.g. _archive, _agents, _agent_scratch). `_meta` is the exception:
// vault-meta documents (the schema spec, MCP design spec, implementation plans)
// must be queryable via /recall, so we include it.
const RESERVED_INCLUDED = new Set(["_meta"]);

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

  return {
    pages_indexed: allPages.length,
    wikis_indexed: wikiSummaries.length,
    links_indexed: Object.keys(links).length,
    duration_ms: Date.now() - start
  };
}
