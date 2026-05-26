import type { Graph, GraphNode } from "@stoa/types/graph";

export interface ViewState {
  mode: "region" | "all" | "focus";
  expandedWikis: Set<string>;
  focusId: string | null;
  hops: number;
  filters?: {
    wikis?: Set<string>;
    types?: Set<string>;
    statuses?: Set<string>;
    tag?: string;
  };
}

const WIKI_NODE = (wiki: string, count: number): GraphNode => ({
  id: `wiki:${wiki}`,
  wiki,
  type: "__wiki__",
  title: wiki,
  summary: "",
  tags: [],
  status: "active",
  updated: "",
  path: "",
  degree: count,
});

export function computeVisibleGraph(graph: Graph, view: ViewState): Graph {
  if (view.mode === "focus" && view.focusId) {
    return neighborhood(graph, view.focusId, view.hops);
  }
  if (view.mode === "all") {
    return applyFilters(graph, view.filters);
  }
  // default: region mode
  return regionView(graph, view.expandedWikis);
}

/**
 * Region view: wikis not in `expanded` collapse to a single super-node.
 * Edges that cross into a collapsed wiki are retargeted onto that wiki's super-node.
 * Duplicate edges (multiple pages targeting the same collapsed wiki) are deduplicated.
 */
function regionView(graph: Graph, expanded: Set<string>): Graph {
  // Count pages per wiki
  const wikiCounts = new Map<string, number>();
  for (const node of graph.nodes) {
    wikiCounts.set(node.wiki, (wikiCounts.get(node.wiki) ?? 0) + 1);
  }

  // Build visible node set: expanded wiki pages + super-nodes for collapsed wikis
  const nodes: GraphNode[] = [];
  const visibleIds = new Set<string>();

  for (const [wiki, count] of wikiCounts) {
    if (expanded.has(wiki)) {
      // Include all real page nodes for this wiki
      for (const node of graph.nodes) {
        if (node.wiki === wiki) {
          nodes.push(node);
          visibleIds.add(node.id);
        }
      }
    } else {
      // Collapse to super-node
      const superNode = WIKI_NODE(wiki, count);
      nodes.push(superNode);
      visibleIds.add(superNode.id);
    }
  }

  // Build a mapping: real page id → visible id (either itself or wiki super-node)
  const toVisible = (id: string): string => {
    if (visibleIds.has(id)) return id;
    // Find the wiki this node belongs to
    const node = graph.nodes.find((n) => n.id === id);
    if (node) return `wiki:${node.wiki}`;
    return id;
  };

  // Remap edges, dropping self-loops and deduplicating
  const seenLinks = new Set<string>();
  const links = [];
  for (const link of graph.links) {
    const src = toVisible(link.source);
    const tgt = toVisible(link.target);
    if (src === tgt) continue; // skip self-loops (both in same collapsed wiki)
    const key = `${src}→${tgt}`;
    if (seenLinks.has(key)) continue;
    seenLinks.add(key);
    links.push({ source: src, target: tgt });
  }

  return { nodes, links };
}

/**
 * BFS neighborhood: returns focus node plus all nodes reachable within `hops` steps
 * in either direction (undirected BFS), along with only the edges among those nodes.
 */
function neighborhood(graph: Graph, focusId: string, hops: number): Graph {
  // Build adjacency: undirected (follow source or target)
  const adj = new Map<string, Set<string>>();
  for (const link of graph.links) {
    if (!adj.has(link.source)) adj.set(link.source, new Set());
    if (!adj.has(link.target)) adj.set(link.target, new Set());
    adj.get(link.source)!.add(link.target);
    adj.get(link.target)!.add(link.source);
  }

  // BFS from focusId up to `hops` distance
  const visited = new Set<string>();
  let frontier = new Set<string>([focusId]);
  visited.add(focusId);

  for (let h = 0; h < hops; h++) {
    const next = new Set<string>();
    for (const id of frontier) {
      for (const neighbor of (adj.get(id) ?? [])) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.add(neighbor);
        }
      }
    }
    frontier = next;
  }

  // Collect nodes in the neighborhood
  const nodeIndex = new Map(graph.nodes.map((n) => [n.id, n]));
  const nodes: GraphNode[] = [];
  for (const id of visited) {
    const node = nodeIndex.get(id);
    if (node) nodes.push(node);
  }

  // Only include edges where both endpoints are in the neighborhood
  const links = graph.links.filter(
    (l) => visited.has(l.source) && visited.has(l.target)
  );

  return { nodes, links };
}

/**
 * All mode: return all nodes/edges, minus those excluded by filters.
 * Filters act as inclusion filters (if set, only matching items are kept).
 * Edges whose endpoints are excluded are also dropped.
 */
function applyFilters(graph: Graph, f?: ViewState["filters"]): Graph {
  if (!f) return { nodes: [...graph.nodes], links: [...graph.links] };

  const nodes = graph.nodes.filter((node) => {
    if (f.wikis && !f.wikis.has(node.wiki)) return false;
    if (f.types && !f.types.has(node.type)) return false;
    if (f.statuses && !f.statuses.has(node.status)) return false;
    if (f.tag && !node.tags.includes(f.tag)) return false;
    return true;
  });

  const visibleIds = new Set(nodes.map((n) => n.id));
  const links = graph.links.filter(
    (l) => visibleIds.has(l.source) && visibleIds.has(l.target)
  );

  return { nodes, links };
}
