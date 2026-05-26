import type { GraphNode } from "@stoa/types/graph";

export interface SearchHit { id: string; score: number; }

export function rankNodes(query: string, nodes: GraphNode[], limit = 20): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const n of nodes) {
    const title = n.title.toLowerCase();
    let score = 0;
    if (n.id.toLowerCase() === q || title === q) score = 100;
    else if (title.startsWith(q)) score = 70;
    else if (title.includes(q)) score = 50;
    else if (n.tags.some((t) => t.toLowerCase().includes(q))) score = 35;
    else if (n.id.toLowerCase().includes(q)) score = 25;
    else if (n.summary.toLowerCase().includes(q)) score = 15;
    if (score > 0) hits.push({ id: n.id, score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
