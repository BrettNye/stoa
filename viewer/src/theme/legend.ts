import type { GraphNode } from "@stoa/types/graph";
import type { Theme } from "@stoa/types/theme";
import { nodeColor, type ColorScales } from "./resolve.js";
import { WIKI_NODE_TYPE } from "../nav/visible-graph.js";

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

/**
 * Build legend rows from the VISIBLE nodes so the legend always matches the
 * canvas exactly:
 *
 * - Region super-nodes (`__wiki__`) are colored by their wiki on the canvas, so
 *   each becomes a by-wiki row (count = the wiki's page count, carried on the
 *   super-node's `degree`).
 * - Real nodes group by `theme.defaultBy` (wiki or type), with rule overrides
 *   surfacing as extra rows whose `sublabel` names the secondary dimension.
 *
 * Every swatch comes from the SAME `nodeColor` the scene uses, so the two can
 * never disagree.
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
    // Color always matches the canvas (super-node -> wiki; real -> rules/scale).
    const color = nodeColor(node, theme, scales);
    let key: string;
    let secondary: string | undefined;
    let weight = 1;

    if (node.type === WIKI_NODE_TYPE) {
      // Super-node: described as its wiki.
      key = node.wiki;
      if (!key) continue;
      weight = node.degree || 1; // degree carries the wiki's page count
    } else {
      key = byType ? node.type : node.wiki;
      if (!key) continue;
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
