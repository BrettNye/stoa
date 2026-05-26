import type { GraphNode } from "@stoa/types/graph";
import type { Theme, ColorRule } from "@stoa/types/theme";

export const PALETTES: Record<string, string[]> = {
  default: ["#61afef", "#98c379", "#c678dd", "#e5c07b", "#e06c75", "#56b6c2", "#d19a66", "#abb2bf"],
  warm: ["#e06c75", "#e5c07b", "#d19a66", "#be5046", "#e8c07d", "#d4956a", "#c67c3e", "#a0522d"],
  "high-contrast": ["#ffffff", "#ffff00", "#00ffff", "#ff00ff", "#00ff00", "#ff6600", "#0099ff", "#ff0066"],
  "colorblind-safe": ["#0072b2", "#e69f00", "#009e73", "#cc79a7", "#56b4e9", "#f0e442", "#d55e00", "#999999"],
};

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

export function resolveNodeColor(node: GraphNode, theme: Theme): string {
  for (const r of theme.perWiki?.[node.wiki] ?? []) {
    if (matches(node, r)) return r.color;
  }
  for (const r of theme.rules) {
    if (matches(node, r)) return r.color;
  }
  const palette = PALETTES[theme.palette] ?? PALETTES.default;
  return hashHue(theme.defaultBy === "type" ? node.type : node.wiki, palette);
}
