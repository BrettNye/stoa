import { it, expect } from "vitest";
import { resolveNodeColor, hashHue, hueScale, PALETTES, type ColorScales } from "./resolve.js";
import type { GraphNode } from "@stoa/types/graph";
import type { Theme } from "@stoa/types/theme";

const node: GraphNode = {
  id: "concept-x",
  wiki: "meal-planning",
  type: "concept",
  title: "",
  summary: "",
  tags: ["recipe"],
  status: "active",
  updated: "",
  path: "",
  degree: 1,
};

// Distinct color scales covering the wikis/types the fixtures use.
const scales: ColorScales = {
  wiki: hueScale(["meal-planning", "different-wiki", "alpha", "beta"]),
  type: hueScale(["concept", "decision", "guide"]),
};

const base: Theme = { name: "t", palette: "default", defaultBy: "wiki", rules: [], perWiki: {} };

it("per-wiki tag rule beats the wiki default", () => {
  const theme: Theme = { ...base, perWiki: { "meal-planning": [{ match: { tag: "recipe" }, color: "#e06c75" }] } };
  expect(resolveNodeColor(node, theme, scales)).toBe("#e06c75");
});

it("per-wiki rule takes precedence over global rules", () => {
  const theme: Theme = {
    ...base,
    rules: [{ match: { type: "concept" }, color: "#61afef" }],
    perWiki: { "meal-planning": [{ match: { tag: "recipe" }, color: "#e06c75" }] },
  };
  expect(resolveNodeColor(node, theme, scales)).toBe("#e06c75");
});

it("global rule is used when no per-wiki rule matches", () => {
  const theme: Theme = { ...base, rules: [{ match: { type: "concept" }, color: "#61afef" }] };
  expect(resolveNodeColor(node, theme, scales)).toBe("#61afef");
});

it("tag match succeeds when node.tags contains the value", () => {
  const theme: Theme = { ...base, rules: [{ match: { tag: "recipe" }, color: "#98c379" }] };
  expect(resolveNodeColor(node, theme, scales)).toBe("#98c379");
});

it("idGlob matching works", () => {
  const theme: Theme = { ...base, rules: [{ match: { idGlob: "concept-*" }, color: "#c678dd" }] };
  expect(resolveNodeColor(node, theme, scales)).toBe("#c678dd");
});

it("no matching rule, defaultBy wiki: color comes from the wiki scale (stable)", () => {
  const c1 = resolveNodeColor(node, base, scales);
  expect(c1).toBe(scales.wiki.get("meal-planning"));
  expect(resolveNodeColor(node, base, scales)).toBe(c1);
});

it("no matching rule, defaultBy type: color comes from the type scale", () => {
  const theme: Theme = { ...base, defaultBy: "type" };
  const sameType: GraphNode = { ...node, wiki: "different-wiki" };
  expect(resolveNodeColor(node, theme, scales)).toBe(scales.type.get("concept"));
  // Same type → same color regardless of wiki.
  expect(resolveNodeColor(sameType, theme, scales)).toBe(scales.type.get("concept"));
});

it("distinct wikis get distinct colors (no collision)", () => {
  const other: GraphNode = { ...node, wiki: "different-wiki" };
  expect(resolveNodeColor(node, base, scales)).not.toBe(resolveNodeColor(other, base, scales));
});

it("a named non-default palette keeps the curated (legacy hash) palette", () => {
  const theme: Theme = { ...base, palette: "warm" };
  expect(PALETTES.warm).toContain(resolveNodeColor(node, theme, scales));
});

it("unknown palette name falls back to the scale without throwing", () => {
  const theme: Theme = { ...base, palette: "nonexistent-palette" };
  expect(() => resolveNodeColor(node, theme, scales)).not.toThrow();
  expect(resolveNodeColor(node, theme, scales)).toBe(scales.wiki.get("meal-planning"));
});

it("hashHue returns a stable color from the palette", () => {
  const palette = ["#aaa", "#bbb", "#ccc"];
  expect(hashHue("mykey", palette)).toBe(hashHue("mykey", palette));
  expect(palette).toContain(hashHue("mykey", palette));
});

it("hueScale assigns a distinct hex color per distinct value", () => {
  const s = hueScale(["a", "b", "c", "d"]);
  const colors = [...s.values()];
  expect(colors).toHaveLength(4);
  expect(new Set(colors).size).toBe(4); // all distinct, no collisions
  for (const c of colors) expect(c).toMatch(/^#[0-9a-f]{6}$/);
});

it("hueScale is stable across input order and dedupes", () => {
  expect(hueScale(["b", "a", "a"])).toEqual(hueScale(["a", "b"]));
});
