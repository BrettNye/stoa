import type { GraphNode } from "@stoa/types/graph";
import type { Theme } from "@stoa/types/theme";
import { resolveNodeColor, type ColorScales } from "./resolve.js";

/** One row in the legend: a swatch color and what it means. */
export interface LegendEntry {
  /** The wiki (by-wiki) or type (by-type) this row belongs to. */
  label: string;
  /** The swatch color, exactly as the scene paints these nodes. */
  color: string;
  /**
   * Set when this color is a rule-driven override within `label`'s group
   * (e.g. meal-planning's `recipe` nodes painted red). Names the secondary
   * dimension value(s) — type in by-wiki mode, wiki in by-type mode — that
   * share this override color.
   */
  sublabel?: string;
  /** How many notes this (label, color) pair represents. */
  count: number;
}

/** Region super-node sentinel emitted by computeVisibleGraph for collapsed wikis. */
const WIKI_NODE_TYPE = "__wiki__";
const NEUTRAL = "#888888";

/**
 * Build legend rows from the VISIBLE nodes so the legend always matches the
 * canvas exactly:
 *
 * - Region super-nodes (`__wiki__`) are colored by their wiki on the canvas, so
 *   each becomes a by-wiki row (color via `scales.wiki`, count = the wiki's page
 *   count, carried on the super-node's `degree`).
 * - Real nodes group by `theme.defaultBy` (wiki or type), colored through the
 *   SAME `resolveNodeColor` the scene uses — including rule overrides, which
 *   surface as extra rows with a `sublabel` naming the secondary dimension.
 */
export function computeLegend(
  nodes: GraphNode[],
  theme: Theme,
  scales: ColorScales,
): LegendEntry[] {
  const byType = theme.defaultBy === "type";

  // key -> color -> { count, secondaries }
  const groups = new Map<
    string,
    Map<string, { count: number; secondaries: Set<string> }>
  >();

  for (const node of nodes) {
    let key: string;
    let color: string;
    let secondary: string | undefined;
    let weight = 1;

    if (node.type === WIKI_NODE_TYPE) {
      // Super-node: described as its wiki, matching the canvas color.
      key = node.wiki;
      if (!key) continue;
      color = scales.wiki.get(node.wiki) ?? NEUTRAL;
      weight = node.degree || 1; // degree carries the wiki's page count
    } else {
      key = byType ? node.type : node.wiki;
      if (!key) continue;
      color = resolveNodeColor(node, theme, scales);
      secondary = byType ? node.wiki : node.type;
    }

    let byColor = groups.get(key);
    if (!byColor) {
      byColor = new Map();
      groups.set(key, byColor);
    }
    let bucket = byColor.get(color);
    if (!bucket) {
      bucket = { count: 0, secondaries: new Set() };
      byColor.set(color, bucket);
    }
    bucket.count += weight;
    if (secondary) bucket.secondaries.add(secondary);
  }

  const entries: LegendEntry[] = [];
  for (const key of [...groups.keys()].sort()) {
    const byColor = groups.get(key)!;
    // Most common color is the group's base; rarer colors are overrides.
    const colors = [...byColor.entries()].sort((a, b) => {
      const d = b[1].count - a[1].count;
      return d !== 0 ? d : a[0].localeCompare(b[0]);
    });
    colors.forEach(([color, info], i) => {
      entries.push({
        label: key,
        color,
        count: info.count,
        ...(i === 0
          ? {}
          : { sublabel: [...info.secondaries].sort().join(", ") }),
      });
    });
  }
  return entries;
}
