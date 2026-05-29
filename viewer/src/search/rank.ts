import type { GraphNode } from "@stoa/types/graph";

export interface SearchHit {
  id: string;
  score: number;
}

/** Fields a query can scope to with a `field:value` prefix. */
const FIELDS = ["tag", "wiki", "type", "status", "id", "title"] as const;
type Field = (typeof FIELDS)[number];

export interface ParsedQuery {
  field: Field | null;
  value: string;
}

/**
 * Parse a leading `field:value` scope (e.g. `type:decision`, `tag:recipe`,
 * `wiki:_meta`). An unknown prefix or no colon falls back to free text over the
 * whole query. The returned `value` is trimmed + lowercased.
 */
export function parseQuery(query: string): ParsedQuery {
  const q = query.trim();
  const m = /^([a-z]+):(.*)$/i.exec(q);
  if (m && (FIELDS as readonly string[]).includes(m[1].toLowerCase())) {
    return { field: m[1].toLowerCase() as Field, value: m[2].trim().toLowerCase() };
  }
  return { field: null, value: q.toLowerCase() };
}

/** Free-text relevance across title / tags / id / summary. */
function freeTextScore(n: GraphNode, q: string): number {
  const title = n.title.toLowerCase();
  if (n.id.toLowerCase() === q || title === q) return 100;
  if (title.startsWith(q)) return 70;
  if (title.includes(q)) return 50;
  if (n.tags.some((t) => t.toLowerCase().includes(q))) return 35;
  if (n.id.toLowerCase().includes(q)) return 25;
  if (n.summary.toLowerCase().includes(q)) return 15;
  return 0;
}

/** Match a single field exactly (100) or by substring (60). */
function scopedScore(n: GraphNode, field: Field, value: string): number {
  if (field === "tag") {
    const tags = n.tags.map((t) => t.toLowerCase());
    if (tags.includes(value)) return 100;
    if (tags.some((t) => t.includes(value))) return 60;
    return 0;
  }
  const fieldVal = (
    field === "wiki"
      ? n.wiki
      : field === "type"
        ? n.type
        : field === "status"
          ? n.status
          : field === "id"
            ? n.id
            : n.title
  ).toLowerCase();
  if (fieldVal === value) return 100;
  if (fieldVal.includes(value)) return 60;
  return 0;
}

export function rankNodes(query: string, nodes: GraphNode[], limit = 20): SearchHit[] {
  const { field, value } = parseQuery(query);
  if (!value) return [];
  const hits: SearchHit[] = [];
  for (const n of nodes) {
    const score = field ? scopedScore(n, field, value) : freeTextScore(n, value);
    if (score > 0) hits.push({ id: n.id, score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
