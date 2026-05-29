import { it, expect } from "vitest";
import { computeLegend } from "./legend.js";
import { resolveNodeColor, hueScale, type ColorScales } from "./resolve.js";
import type { GraphNode } from "@stoa/types/graph";
import type { Theme } from "@stoa/types/theme";

function node(over: Partial<GraphNode> & Pick<GraphNode, "id" | "wiki" | "type">): GraphNode {
  return {
    title: "",
    summary: "",
    tags: [],
    status: "active",
    updated: "",
    path: "",
    degree: 1,
    ...over,
  };
}

const scales: ColorScales = {
  wiki: hueScale(["alpha", "beta", "meal-planning"]),
  type: hueScale(["concept", "decision", "guide", "recipe"]),
};

const byWiki: Theme = { name: "t", palette: "default", defaultBy: "wiki", rules: [], perWiki: {} };

it("by-wiki: one entry per wiki, colored exactly like resolveNodeColor", () => {
  const a = node({ id: "concept-a", wiki: "alpha", type: "concept" });
  const b = node({ id: "decision-b", wiki: "beta", type: "decision" });
  const entries = computeLegend([a, b], byWiki, scales);

  expect(entries.map((e) => e.label)).toEqual(["alpha", "beta"]); // sorted
  const alpha = entries.find((e) => e.label === "alpha")!;
  expect(alpha.color).toBe(resolveNodeColor(a, byWiki, scales));
  expect(alpha.sublabel).toBeUndefined();
  expect(alpha.count).toBe(1);
});

it("by-wiki: multiple nodes in a wiki collapse to one entry with a count", () => {
  const a1 = node({ id: "concept-a1", wiki: "alpha", type: "concept" });
  const a2 = node({ id: "guide-a2", wiki: "alpha", type: "guide" });
  const entries = computeLegend([a1, a2], byWiki, scales);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ label: "alpha", count: 2 });
});

it("by-type: groups by type, color keyed on type", () => {
  const theme: Theme = { ...byWiki, defaultBy: "type" };
  const a = node({ id: "concept-a", wiki: "alpha", type: "concept" });
  const b = node({ id: "concept-b", wiki: "beta", type: "concept" });
  const c = node({ id: "decision-c", wiki: "alpha", type: "decision" });
  const entries = computeLegend([a, b, c], theme, scales);

  expect(entries.map((e) => e.label)).toEqual(["concept", "decision"]);
  const concept = entries.find((e) => e.label === "concept")!;
  expect(concept.count).toBe(2); // both concepts share the type color
  expect(concept.color).toBe(resolveNodeColor(a, theme, scales));
});

it("reflects a per-wiki rule override as a separate sub-entry", () => {
  const theme: Theme = {
    ...byWiki,
    perWiki: { "meal-planning": [{ match: { type: "recipe" }, color: "#e06c75" }] },
  };
  // Two non-recipe nodes (base color, count 2) + one recipe (override, count 1)
  // so the base is unambiguously the higher-count row.
  const c1 = node({ id: "concept-1", wiki: "meal-planning", type: "concept" });
  const c2 = node({ id: "guide-2", wiki: "meal-planning", type: "guide" });
  const recipe = node({ id: "recipe-soup", wiki: "meal-planning", type: "recipe" });
  const entries = computeLegend([c1, c2, recipe], theme, scales);

  expect(entries).toHaveLength(2);
  const override = entries.find((e) => e.color === "#e06c75")!;
  expect(override.label).toBe("meal-planning");
  expect(override.sublabel).toBe("recipe");
  const baseRow = entries.find((e) => e.color !== "#e06c75")!;
  expect(baseRow.label).toBe("meal-planning");
  expect(baseRow.sublabel).toBeUndefined();
  expect(baseRow.count).toBe(2);
});

it("a region super-node becomes a by-wiki row colored by the wiki scale", () => {
  const superAlpha = node({ id: "wiki:alpha", wiki: "alpha", type: "__wiki__", degree: 42 });
  const entries = computeLegend([superAlpha], byWiki, scales);
  expect(entries).toHaveLength(1);
  expect(entries[0].label).toBe("alpha");
  expect(entries[0].color).toBe(scales.wiki.get("alpha"));
  expect(entries[0].count).toBe(42); // degree carries the wiki's page count
});

it("region-collapsed view (only super-nodes) lists wikis even under by-type", () => {
  // The reported confusion: by-type while collapsed showed type rows that didn't
  // match the wiki-colored bubbles. Super-nodes are now always wiki rows.
  const byType: Theme = { ...byWiki, defaultBy: "type" };
  const sa = node({ id: "wiki:alpha", wiki: "alpha", type: "__wiki__", degree: 3 });
  const sb = node({ id: "wiki:beta", wiki: "beta", type: "__wiki__", degree: 5 });
  const entries = computeLegend([sa, sb], byType, scales);
  expect(entries.map((e) => e.label).sort()).toEqual(["alpha", "beta"]);
  expect(entries.find((e) => e.label === "alpha")!.color).toBe(scales.wiki.get("alpha"));
});

it("skips nodes with an empty grouping key", () => {
  const real = node({ id: "concept-a", wiki: "alpha", type: "concept" });
  const noWiki = node({ id: "orphan", wiki: "", type: "concept" });
  const entries = computeLegend([real, noWiki], byWiki, scales);
  expect(entries).toHaveLength(1);
  expect(entries[0].label).toBe("alpha");
});

it("returns an empty list when given no usable nodes", () => {
  expect(computeLegend([], byWiki, scales)).toEqual([]);
});
