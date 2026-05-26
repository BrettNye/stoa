import { it, expect } from "vitest";
import { resolveNodeColor, hashHue, PALETTES } from "./resolve.js";
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

it("per-wiki tag rule beats the wiki default", () => {
  const theme: Theme = {
    name: "t",
    palette: "default",
    defaultBy: "wiki",
    rules: [],
    perWiki: {
      "meal-planning": [{ match: { tag: "recipe" }, color: "#e06c75" }],
    },
  };
  expect(resolveNodeColor(node, theme)).toBe("#e06c75");
});

it("per-wiki rule takes precedence over global rules", () => {
  const theme: Theme = {
    name: "t",
    palette: "default",
    defaultBy: "wiki",
    rules: [{ match: { type: "concept" }, color: "#61afef" }],
    perWiki: {
      "meal-planning": [{ match: { tag: "recipe" }, color: "#e06c75" }],
    },
  };
  expect(resolveNodeColor(node, theme)).toBe("#e06c75");
});

it("global rule is used when no per-wiki rule matches", () => {
  const theme: Theme = {
    name: "t",
    palette: "default",
    defaultBy: "wiki",
    rules: [{ match: { type: "concept" }, color: "#61afef" }],
    perWiki: {},
  };
  expect(resolveNodeColor(node, theme)).toBe("#61afef");
});

it("tag match succeeds when node.tags contains the value", () => {
  const theme: Theme = {
    name: "t",
    palette: "default",
    defaultBy: "wiki",
    rules: [{ match: { tag: "recipe" }, color: "#98c379" }],
    perWiki: {},
  };
  expect(resolveNodeColor(node, theme)).toBe("#98c379");
});

it("tag match fails when node.tags does not contain the value", () => {
  const nodeNoTag: GraphNode = { ...node, tags: [] };
  const theme: Theme = {
    name: "t",
    palette: "default",
    defaultBy: "wiki",
    rules: [{ match: { tag: "recipe" }, color: "#98c379" }],
    perWiki: {},
  };
  // Falls back to palette hue
  const color = resolveNodeColor(nodeNoTag, theme);
  expect(color).not.toBe("#98c379");
  expect(PALETTES.default).toContain(color);
});

it("with no matching rule and defaultBy wiki, returns stable hue keyed on wiki", () => {
  const theme: Theme = {
    name: "t",
    palette: "default",
    defaultBy: "wiki",
    rules: [],
    perWiki: {},
  };
  const color1 = resolveNodeColor(node, theme);
  const color2 = resolveNodeColor(node, theme);
  expect(color1).toBe(color2);
  expect(PALETTES.default).toContain(color1);
});

it("with no matching rule and defaultBy type, returns stable hue keyed on type", () => {
  const theme: Theme = {
    name: "t",
    palette: "default",
    defaultBy: "type",
    rules: [],
    perWiki: {},
  };
  const sameTypeNode: GraphNode = { ...node, wiki: "different-wiki" };
  const color1 = resolveNodeColor(node, theme);
  const color2 = resolveNodeColor(sameTypeNode, theme);
  expect(color1).toBe(color2); // same type → same color
  expect(PALETTES.default).toContain(color1);
});

it("defaultBy wiki: different wikis can yield different colors", () => {
  const theme: Theme = {
    name: "t",
    palette: "default",
    defaultBy: "wiki",
    rules: [],
    perWiki: {},
  };
  const otherNode: GraphNode = { ...node, wiki: "zyxwvu-unique-wiki" };
  // Not asserting they differ (small palette, possible collision) but hashHue is deterministic
  const c1 = resolveNodeColor(node, theme);
  const c2 = resolveNodeColor(otherNode, theme);
  // Both must be valid palette entries
  expect(PALETTES.default).toContain(c1);
  expect(PALETTES.default).toContain(c2);
});

it("unknown palette name falls back to PALETTES.default without throwing", () => {
  const theme: Theme = {
    name: "t",
    palette: "nonexistent-palette",
    defaultBy: "wiki",
    rules: [],
    perWiki: {},
  };
  expect(() => resolveNodeColor(node, theme)).not.toThrow();
  const color = resolveNodeColor(node, theme);
  expect(PALETTES.default).toContain(color);
});

it("hashHue returns a stable color from the palette", () => {
  const palette = ["#aaa", "#bbb", "#ccc"];
  const c1 = hashHue("mykey", palette);
  const c2 = hashHue("mykey", palette);
  expect(c1).toBe(c2);
  expect(palette).toContain(c1);
});

it("idGlob matching works", () => {
  const theme: Theme = {
    name: "t",
    palette: "default",
    defaultBy: "wiki",
    rules: [{ match: { idGlob: "concept-*" }, color: "#c678dd" }],
    perWiki: {},
  };
  expect(resolveNodeColor(node, theme)).toBe("#c678dd");
});

it("idGlob non-matching node falls through to palette", () => {
  const theme: Theme = {
    name: "t",
    palette: "default",
    defaultBy: "wiki",
    rules: [{ match: { idGlob: "decision-*" }, color: "#c678dd" }],
    perWiki: {},
  };
  const color = resolveNodeColor(node, theme);
  expect(color).not.toBe("#c678dd");
  expect(PALETTES.default).toContain(color);
});
