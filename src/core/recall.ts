import { readFileSync } from "node:fs";
import { join } from "node:path";
import natural from "natural";
import { loadIndex, loadTokens, queryPages } from "./index.js";
import type { IndexedPage, VaultIndex } from "./index.js";
import { parseFrontmatter } from "./frontmatter.js";
import { expandAliases } from "./aliases.js";

const STOP_WORDS = new Set(["the","and","of","a","an","in","to","is","for","on","with","as","at","by","or","be","this","that","it","from","are","was","were","not","but","if"]);
const stemmer = natural.PorterStemmer;

function tokenize(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t))
    .map(t => stemmer.stem(t));
}

function intersect(a: string[] | undefined, b: Set<string>): number {
  if (!a) return 0;
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

const CONFIDENCE_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

function score(page: IndexedPage, queryTokens: Set<string>): number {
  const tags = intersect(page.tokens?.tags, queryTokens) * 3;
  const title = intersect(page.tokens?.title, queryTokens) * 2;
  const summary = intersect(page.tokens?.summary, queryTokens) * 1;
  const body = intersect(page.tokens?.body, queryTokens) * 0.5;
  let s = tags + title + summary + body;
  if (page.type === "synthesis") s += 10;
  return s;
}

export interface RecallInput {
  topic: string;
  wiki?: string;
  layer?: "knowledge" | "execution" | "all";
  include_archive?: boolean;
  limit?: number;
  by_agent?: string;
}

export interface RecallHit {
  id: string;
  title: string;
  type: string;
  wiki: string;
  summary: string;
  score: number;
  status: string;
  confidence?: string;
  updated: string;
}

export interface RecallResult {
  hits: RecallHit[];
  synthesis_inline: { id: string; body: string }[];
  total_candidates: number;
  segmented: { knowledge: number; execution: number; archive: number };
}

export function recall(vaultPath: string, input: RecallInput): RecallResult {
  const idx: VaultIndex = loadIndex(vaultPath);
  const tokensById = loadTokens(vaultPath);
  const layer = input.layer ?? "knowledge";
  const limit = input.limit ?? 20;
  const queryTokens = new Set(tokenize(input.topic));
  if (queryTokens.size === 0) {
    return { hits: [], synthesis_inline: [], total_candidates: 0, segmented: { knowledge: 0, execution: 0, archive: 0 } };
  }

  const candidates = queryPages(idx, { wiki: input.wiki, layer })
    .map(p => ({ ...p, tokens: tokensById[p.id] }));
  const scored = candidates
    .map(p => ({ page: p, score: score(p, queryTokens) }))
    .filter(({ score: s }) => s > 0);

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const cA = CONFIDENCE_RANK[a.page.confidence ?? ""] ?? 0;
    const cB = CONFIDENCE_RANK[b.page.confidence ?? ""] ?? 0;
    if (cB !== cA) return cB - cA;
    return b.page.updated.localeCompare(a.page.updated);
  });

  let top = scored.slice(0, limit);

  if (input.by_agent) {
    const profileId = input.by_agent.startsWith("profile-")
      ? input.by_agent
      : `profile-${input.by_agent}`;
    const expandedProfileIds = expandAliases(vaultPath, profileId);
    const targetAuthors = new Set<string>();
    for (const pid of expandedProfileIds) {
      const bare = pid.startsWith("profile-") ? pid.slice("profile-".length) : pid;
      targetAuthors.add(`agent:${bare}`);
    }
    top = top.filter(({ page }) => {
      try {
        const raw = readFileSync(join(vaultPath, page.path), "utf8");
        const { frontmatter: fm } = parseFrontmatter(raw);
        if (fm.author && targetAuthors.has(String(fm.author))) return true;
        if (fm.claimed_by && targetAuthors.has(String(fm.claimed_by))) return true;
        return false;
      } catch {
        return false;
      }
    });
  }

  const hits: RecallHit[] = top.map(({ page, score: s }) => ({
    id: page.id,
    title: page.title,
    type: page.type,
    wiki: page.wiki,
    summary: page.summary,
    score: s,
    status: page.status,
    confidence: page.confidence,
    updated: page.updated
  }));

  const synthesis_inline = top
    .filter(({ page }) => page.type === "synthesis")
    .slice(0, 3)
    .map(({ page }) => {
      const raw = readFileSync(join(vaultPath, page.path), "utf8");
      const i = raw.indexOf("\n---\n", 4);
      return { id: page.id, body: i === -1 ? "" : raw.slice(i + 5).trim() };
    });

  return {
    hits,
    synthesis_inline,
    total_candidates: candidates.length,
    segmented: {
      knowledge: hits.filter(h => ["concept","spec","decision","synthesis","guide","source","idea","question"].includes(h.type)).length,
      execution: hits.filter(h => ["task","journal"].includes(h.type)).length,
      archive: 0
    }
  };
}
