import type { Graph, GraphNode, GraphLink, RawPage, LinksIndex } from "../types/graph.js";

export function buildGraph(pages: RawPage[], links: LinksIndex): Graph {
  const ids = new Set(pages.map((p) => p.id));
  const nodes: GraphNode[] = pages.map((p) => {
    const e = links[p.id];
    const degree = (e?.outbound.length ?? 0) + (e?.inbound.length ?? 0);
    return { ...p, degree };
  });
  const out: GraphLink[] = [];
  const seen = new Set<string>();
  for (const [source, e] of Object.entries(links)) {
    if (!ids.has(source)) continue;
    for (const target of e.outbound) {
      if (!ids.has(target)) continue;
      const key = `${source}\0${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ source, target });
    }
  }
  return { nodes, links: out };
}
