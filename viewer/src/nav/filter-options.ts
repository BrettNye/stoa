import type { GraphNode } from "@stoa/types/graph";
import { WIKI_NODE_TYPE, type ViewState } from "./visible-graph.js";

export interface FilterOptions {
  wikis: string[];
  types: string[];
  statuses: string[];
}

/**
 * Distinct, sorted wiki / type / status values present in the graph — the
 * options a filter UI offers. Skips region super-nodes and blank values.
 */
export function filterOptions(nodes: GraphNode[]): FilterOptions {
  const wikis = new Set<string>();
  const types = new Set<string>();
  const statuses = new Set<string>();
  for (const n of nodes) {
    if (n.type === WIKI_NODE_TYPE) continue; // skip synthetic super-nodes
    if (n.wiki) wikis.add(n.wiki);
    if (n.type) types.add(n.type);
    if (n.status) statuses.add(n.status);
  }
  const sorted = (s: Set<string>) => [...s].sort();
  return { wikis: sorted(wikis), types: sorted(types), statuses: sorted(statuses) };
}

export interface FilterSelection {
  wikis: Set<string>;
  types: Set<string>;
  statuses: Set<string>;
  tag: string;
}

/**
 * Build a `ViewState.filters` object from a UI selection. An EMPTY selection in
 * a dimension means "no filter" (`undefined`) — NOT "exclude everything".
 * `computeVisibleGraph`'s `applyFilters` treats a present-but-empty Set as
 * "match nothing" (`set.has(x)` is always false), so empty dimensions MUST be
 * dropped to `undefined` here. Blank/whitespace tag is likewise dropped.
 */
export function toFilters(sel: FilterSelection): NonNullable<ViewState["filters"]> {
  const orUndef = (s: Set<string>) => (s.size > 0 ? new Set(s) : undefined);
  const tag = sel.tag.trim();
  return {
    wikis: orUndef(sel.wikis),
    types: orUndef(sel.types),
    statuses: orUndef(sel.statuses),
    tag: tag.length > 0 ? tag : undefined,
  };
}

/** Whether any dimension is actually constraining the view. */
export function hasActiveFilter(f: ViewState["filters"]): boolean {
  return !!f && !!(f.wikis || f.types || f.statuses || f.tag);
}
