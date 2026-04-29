import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { NoteType, PageStatus } from "./frontmatter.js";

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
