import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { NoteType, PageStatus } from "./frontmatter.js";
import { parseFrontmatter } from "./frontmatter.js";
import natural from "natural";

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
  const idx: VaultIndex = { wikis: [], pages: [], links: {} };
  const wikisPath = join(vaultPath, "_index", "wikis.json");
  const pagesPath = join(vaultPath, "_index", "pages.json");
  const linksPath = join(vaultPath, "_index", "links.json");
  if (existsSync(wikisPath)) idx.wikis = JSON.parse(readFileSync(wikisPath, "utf8")).wikis ?? [];
  if (existsSync(pagesPath)) idx.pages = JSON.parse(readFileSync(pagesPath, "utf8")).pages ?? [];
  if (existsSync(linksPath)) idx.links = JSON.parse(readFileSync(linksPath, "utf8")) ?? {};
  return idx;
}

export interface PageTokens {
  title: string[];
  summary: string[];
  body: string[];
  tags: string[];
}

export function loadTokens(vaultPath: string): Record<string, PageTokens> {
  const path = join(vaultPath, "_index", "tokens.json");
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8"));
}

export interface PageFilter {
  wiki?: string;
  type?: NoteType;
  layer?: "knowledge" | "execution" | "all";
  channel?: string;
  status?: PageStatus;
}

export function queryPages(idx: VaultIndex, f: PageFilter): IndexedPage[] {
  return idx.pages.filter(p => {
    if (f.wiki && p.wiki !== f.wiki) return false;
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
 * `recall` without requiring callers to run `vault.reindex` first.
 */
export function upsertPage(vaultPath: string, pagePath: string): void {
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
  const filtered = (pagesData.pages ?? []).filter((p: any) => p.id !== id);
  filtered.push(entry);
  writeFileSync(pagesPath, JSON.stringify({ pages: filtered }, null, 2));

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
}
