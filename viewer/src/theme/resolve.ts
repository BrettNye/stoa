import type { GraphNode } from "@stoa/types/graph";
import type { Theme, ColorRule } from "@stoa/types/theme";
import { WIKI_NODE_TYPE } from "../nav/visible-graph.js";

export const PALETTES: Record<string, string[]> = {
  default: ["#61afef", "#98c379", "#c678dd", "#e5c07b", "#e06c75", "#56b6c2", "#d19a66", "#abb2bf"],
  warm: ["#e06c75", "#e5c07b", "#d19a66", "#be5046", "#e8c07d", "#d4956a", "#c67c3e", "#a0522d"],
  "high-contrast": ["#ffffff", "#ffff00", "#00ffff", "#ff00ff", "#00ff00", "#ff6600", "#0099ff", "#ff0066"],
  "colorblind-safe": ["#0072b2", "#e69f00", "#009e73", "#cc79a7", "#56b4e9", "#f0e442", "#d55e00", "#999999"],
};

/** Neutral grey used when no rule, scale, or palette resolves a color. */
export const NEUTRAL = "#888888";

/**
 * Per-dimension color scales: each distinct wiki/type maps to its own color.
 * Built once from the full graph (see `hueScale`) so colors are stable and
 * distinct regardless of which nodes are currently visible.
 */
export interface ColorScales {
  wiki: Map<string, string>;
  type: Map<string, string>;
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((((h % 360) + 360) % 360)) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * Assign each distinct value an evenly-spaced, deterministic hue, so N values
 * get N visually-distinct colors with NO hash collisions. Stable: the same set
 * of values always yields the same colors (sorted before assignment). Drives
 * the default by-wiki / by-type coloring (and the wiki coloring of region
 * super-nodes), replacing the old hash-into-8-palette fallback.
 */
export function hueScale(values: string[], s = 0.6, l = 0.6): Map<string, string> {
  const distinct = [...new Set(values)].sort();
  const n = distinct.length || 1;
  const map = new Map<string, string>();
  distinct.forEach((v, i) => map.set(v, hslToHex(Math.round((360 * i) / n), s, l)));
  return map;
}

function globToRe(glob: string): RegExp {
  return new RegExp(
    "^" + glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"
  );
}

function matches(node: GraphNode, r: ColorRule): boolean {
  const m = r.match;
  if (m.wiki && m.wiki !== node.wiki) return false;
  if (m.type && m.type !== node.type) return false;
  if (m.status && m.status !== node.status) return false;
  if (m.tag && !node.tags.includes(m.tag)) return false;
  if (m.idGlob && !globToRe(m.idGlob).test(node.id)) return false;
  return true;
}

export function hashHue(key: string, palette: string[]): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = ((h * 31 + key.charCodeAt(i)) >>> 0);
  return palette[h % palette.length];
}

/**
 * Resolve a node's color: per-wiki rules first, then global rules (first match
 * wins), else the default-dimension color. The default view uses the distinct
 * `scales` (no collisions); a named, non-"default" palette keeps the legacy
 * hash-into-palette behavior (the user opts into a curated, possibly-colliding
 * palette).
 */
export function resolveNodeColor(node: GraphNode, theme: Theme, scales: ColorScales): string {
  for (const r of theme.perWiki?.[node.wiki] ?? []) {
    if (matches(node, r)) return r.color;
  }
  for (const r of theme.rules) {
    if (matches(node, r)) return r.color;
  }
  const byType = theme.defaultBy === "type";
  const key = byType ? node.type : node.wiki;
  if (theme.palette && theme.palette !== "default" && PALETTES[theme.palette]) {
    return hashHue(key, PALETTES[theme.palette]);
  }
  return (byType ? scales.type : scales.wiki).get(key) ?? NEUTRAL;
}

/**
 * Single source of truth for how the canvas AND the legend color a node.
 * A region super-node (`__wiki__`) is always colored by its wiki — its
 * synthetic type is meaningless for by-type coloring — and every real node
 * goes through `resolveNodeColor`. Use this everywhere a node needs a color so
 * the scene and legend can never disagree.
 */
export function nodeColor(node: GraphNode, theme: Theme, scales: ColorScales): string {
  if (node.type === WIKI_NODE_TYPE) return scales.wiki.get(node.wiki) ?? NEUTRAL;
  return resolveNodeColor(node, theme, scales);
}
