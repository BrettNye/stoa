import { it, expect } from "vitest";
import { filterOptions, toFilters, hasActiveFilter } from "./filter-options.js";
import type { GraphNode } from "@stoa/types/graph";

function node(over: Partial<GraphNode> & Pick<GraphNode, "id">): GraphNode {
  return {
    wiki: "w",
    type: "concept",
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

it("filterOptions returns distinct, sorted values and skips super-nodes + blanks", () => {
  const opts = filterOptions([
    node({ id: "a", wiki: "beta", type: "guide", status: "draft" }),
    node({ id: "b", wiki: "alpha", type: "concept", status: "active" }),
    node({ id: "c", wiki: "alpha", type: "concept", status: "active" }), // dupes
    node({ id: "wiki:alpha", wiki: "alpha", type: "__wiki__", status: "active" }), // super-node skipped
    node({ id: "blank", wiki: "", type: "", status: "" }), // blanks skipped
  ]);
  expect(opts.wikis).toEqual(["alpha", "beta"]);
  expect(opts.types).toEqual(["concept", "guide"]);
  expect(opts.statuses).toEqual(["active", "draft"]);
});

it("toFilters drops EMPTY dimensions to undefined (not an empty Set)", () => {
  // The footgun: an empty Set passed to applyFilters excludes every node.
  const f = toFilters({
    wikis: new Set(),
    types: new Set(["decision"]),
    statuses: new Set(),
    tag: "",
  });
  expect(f.wikis).toBeUndefined();
  expect(f.statuses).toBeUndefined();
  expect(f.tag).toBeUndefined();
  expect(f.types).toEqual(new Set(["decision"]));
});

it("toFilters trims the tag and copies sets (no shared reference)", () => {
  const src = new Set(["alpha"]);
  const f = toFilters({ wikis: src, types: new Set(), statuses: new Set(), tag: "  recipe  " });
  expect(f.tag).toBe("recipe");
  expect(f.wikis).toEqual(new Set(["alpha"]));
  expect(f.wikis).not.toBe(src); // defensive copy
});

it("hasActiveFilter reflects whether any dimension constrains the view", () => {
  expect(hasActiveFilter(undefined)).toBe(false);
  expect(hasActiveFilter({})).toBe(false);
  expect(hasActiveFilter({ tag: "x" })).toBe(true);
  expect(hasActiveFilter({ types: new Set(["concept"]) })).toBe(true);
});
