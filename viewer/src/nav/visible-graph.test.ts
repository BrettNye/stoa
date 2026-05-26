import { it, expect } from "vitest";
import { computeVisibleGraph, type ViewState } from "./visible-graph.js";

// Fixture: two wikis (w1, w2), two nodes (a, b), one cross-wiki link a->b
const g = {
  nodes: [
    { id: "a", wiki: "w1", type: "concept", title: "A", summary: "", tags: [], status: "active", updated: "", path: "", degree: 1 },
    { id: "b", wiki: "w2", type: "concept", title: "B", summary: "", tags: [], status: "active", updated: "", path: "", degree: 1 },
  ],
  links: [{ source: "a", target: "b" }],
};
const base: ViewState = { mode: "region", expandedWikis: new Set(), focusId: null, hops: 1 };

// --- AC1: Region mode, no wikis expanded ---
it("region view with nothing expanded shows one super-node per wiki", () => {
  const v = computeVisibleGraph(g, base);
  expect(v.nodes.map((n) => n.id).sort()).toEqual(["wiki:w1", "wiki:w2"]);
});

it("region view collapsed super-nodes have type __wiki__ and degree = page count", () => {
  const v = computeVisibleGraph(g, base);
  const w1 = v.nodes.find((n) => n.id === "wiki:w1");
  const w2 = v.nodes.find((n) => n.id === "wiki:w2");
  expect(w1?.type).toBe("__wiki__");
  expect(w1?.degree).toBe(1);
  expect(w2?.type).toBe("__wiki__");
  expect(w2?.degree).toBe(1);
});

it("region view collapsed: no real page nodes appear", () => {
  const v = computeVisibleGraph(g, base);
  const realIds = v.nodes.filter((n) => !n.id.startsWith("wiki:")).map((n) => n.id);
  expect(realIds).toEqual([]);
});

// --- AC2: Region mode, a wiki expanded ---
it("region view with w1 expanded shows w1 page nodes and w2 super-node", () => {
  const view: ViewState = { ...base, expandedWikis: new Set(["w1"]) };
  const v = computeVisibleGraph(g, view);
  const ids = v.nodes.map((n) => n.id).sort();
  expect(ids).toEqual(["a", "wiki:w2"]);
});

it("region view expanded wiki's cross-wiki edge retargets onto collapsed super-node", () => {
  const view: ViewState = { ...base, expandedWikis: new Set(["w1"]) };
  const v = computeVisibleGraph(g, view);
  // a->b should become a->wiki:w2 because w2 is collapsed
  const link = v.links.find((l) => l.source === "a");
  expect(link?.target).toBe("wiki:w2");
});

it("region view expanded wiki: intra-wiki edges remain unchanged", () => {
  // Add an intra-wiki edge within w1
  const g2 = {
    nodes: [
      { id: "a", wiki: "w1", type: "concept", title: "", summary: "", tags: [], status: "active", updated: "", path: "", degree: 2 },
      { id: "c", wiki: "w1", type: "concept", title: "", summary: "", tags: [], status: "active", updated: "", path: "", degree: 2 },
      { id: "b", wiki: "w2", type: "concept", title: "", summary: "", tags: [], status: "active", updated: "", path: "", degree: 1 },
    ],
    links: [
      { source: "a", target: "c" },  // intra-w1
      { source: "a", target: "b" },  // cross-wiki
    ],
  };
  const view: ViewState = { ...base, expandedWikis: new Set(["w1"]) };
  const v = computeVisibleGraph(g2, view);
  const intra = v.links.find((l) => l.source === "a" && l.target === "c");
  expect(intra).toBeDefined();
});

// --- AC3: Focus mode (BFS neighborhood) ---
it("focus mode returns focus node plus nodes within hops BFS distance", () => {
  // Graph: a -> b -> c; focus on a with hops=1 → should return a, b
  const g3 = {
    nodes: [
      { id: "a", wiki: "w1", type: "concept", title: "", summary: "", tags: [], status: "active", updated: "", path: "", degree: 2 },
      { id: "b", wiki: "w1", type: "concept", title: "", summary: "", tags: [], status: "active", updated: "", path: "", degree: 2 },
      { id: "c", wiki: "w1", type: "concept", title: "", summary: "", tags: [], status: "active", updated: "", path: "", degree: 1 },
    ],
    links: [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ],
  };
  const view: ViewState = { mode: "focus", expandedWikis: new Set(), focusId: "a", hops: 1 };
  const v = computeVisibleGraph(g3, view);
  expect(v.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
});

it("focus mode hops=2 includes nodes 2 steps away", () => {
  const g3 = {
    nodes: [
      { id: "a", wiki: "w1", type: "concept", title: "", summary: "", tags: [], status: "active", updated: "", path: "", degree: 2 },
      { id: "b", wiki: "w1", type: "concept", title: "", summary: "", tags: [], status: "active", updated: "", path: "", degree: 2 },
      { id: "c", wiki: "w1", type: "concept", title: "", summary: "", tags: [], status: "active", updated: "", path: "", degree: 1 },
    ],
    links: [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ],
  };
  const view: ViewState = { mode: "focus", expandedWikis: new Set(), focusId: "a", hops: 2 };
  const v = computeVisibleGraph(g3, view);
  expect(v.nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c"]);
});

it("focus mode returns only edges among the neighborhood nodes", () => {
  const g3 = {
    nodes: [
      { id: "a", wiki: "w1", type: "concept", title: "", summary: "", tags: [], status: "active", updated: "", path: "", degree: 2 },
      { id: "b", wiki: "w1", type: "concept", title: "", summary: "", tags: [], status: "active", updated: "", path: "", degree: 2 },
      { id: "c", wiki: "w1", type: "concept", title: "", summary: "", tags: [], status: "active", updated: "", path: "", degree: 1 },
    ],
    links: [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ],
  };
  const view: ViewState = { mode: "focus", expandedWikis: new Set(), focusId: "a", hops: 1 };
  const v = computeVisibleGraph(g3, view);
  // only a->b should appear; b->c should NOT since c is outside hops=1
  expect(v.links).toHaveLength(1);
  expect(v.links[0]).toEqual({ source: "a", target: "b" });
});

it("focus mode with null focusId falls through to region mode", () => {
  const view: ViewState = { mode: "focus", expandedWikis: new Set(), focusId: null, hops: 1 };
  const v = computeVisibleGraph(g, view);
  // no focusId → region mode behavior
  expect(v.nodes.map((n) => n.id).sort()).toEqual(["wiki:w1", "wiki:w2"]);
});

// --- AC4: All mode with filters ---
it("all mode returns every node and edge when no filters", () => {
  const view: ViewState = { mode: "all", expandedWikis: new Set(), focusId: null, hops: 1 };
  const v = computeVisibleGraph(g, view);
  expect(v.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
  expect(v.links).toHaveLength(1);
});

it("all mode filters by wiki", () => {
  const view: ViewState = {
    mode: "all",
    expandedWikis: new Set(),
    focusId: null,
    hops: 1,
    filters: { wikis: new Set(["w1"]) },
  };
  const v = computeVisibleGraph(g, view);
  expect(v.nodes.map((n) => n.id)).toEqual(["a"]);
  // link a->b should be dropped because b is excluded
  expect(v.links).toHaveLength(0);
});

it("all mode filters by type", () => {
  const gMixed = {
    nodes: [
      { id: "a", wiki: "w1", type: "concept", title: "", summary: "", tags: [], status: "active", updated: "", path: "", degree: 1 },
      { id: "b", wiki: "w1", type: "guide", title: "", summary: "", tags: [], status: "active", updated: "", path: "", degree: 1 },
    ],
    links: [{ source: "a", target: "b" }],
  };
  const view: ViewState = {
    mode: "all",
    expandedWikis: new Set(),
    focusId: null,
    hops: 1,
    filters: { types: new Set(["concept"]) },
  };
  const v = computeVisibleGraph(gMixed, view);
  expect(v.nodes.map((n) => n.id)).toEqual(["a"]);
  expect(v.links).toHaveLength(0);
});

it("all mode filters by status", () => {
  const gMixed = {
    nodes: [
      { id: "a", wiki: "w1", type: "concept", title: "", summary: "", tags: [], status: "active", updated: "", path: "", degree: 1 },
      { id: "b", wiki: "w1", type: "concept", title: "", summary: "", tags: [], status: "draft", updated: "", path: "", degree: 1 },
    ],
    links: [{ source: "a", target: "b" }],
  };
  const view: ViewState = {
    mode: "all",
    expandedWikis: new Set(),
    focusId: null,
    hops: 1,
    filters: { statuses: new Set(["active"]) },
  };
  const v = computeVisibleGraph(gMixed, view);
  expect(v.nodes.map((n) => n.id)).toEqual(["a"]);
  expect(v.links).toHaveLength(0);
});

it("all mode filters by tag", () => {
  const gMixed = {
    nodes: [
      { id: "a", wiki: "w1", type: "concept", title: "", summary: "", tags: ["typescript", "fp"], status: "active", updated: "", path: "", degree: 1 },
      { id: "b", wiki: "w1", type: "concept", title: "", summary: "", tags: ["python"], status: "active", updated: "", path: "", degree: 1 },
    ],
    links: [{ source: "a", target: "b" }],
  };
  const view: ViewState = {
    mode: "all",
    expandedWikis: new Set(),
    focusId: null,
    hops: 1,
    filters: { tag: "typescript" },
  };
  const v = computeVisibleGraph(gMixed, view);
  expect(v.nodes.map((n) => n.id)).toEqual(["a"]);
  expect(v.links).toHaveLength(0);
});
