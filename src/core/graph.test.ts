import { it, expect } from "vitest";
import { buildGraph } from "./graph.js";

it("computes degree and drops dangling edges", () => {
  const pages = [
    { id: "a", type: "concept", wiki: "w", title: "", summary: "", tags: [], status: "active", updated: "", path: "p/a.md" },
    { id: "b", type: "concept", wiki: "w", title: "", summary: "", tags: [], status: "active", updated: "", path: "p/b.md" },
  ];
  const links = { a: { outbound: ["b", "ghost"], inbound: [] }, b: { outbound: [], inbound: ["a"] } };
  const g = buildGraph(pages, links);
  expect(g.links).toEqual([{ source: "a", target: "b" }]); // ghost dropped
  expect(g.nodes.find((n) => n.id === "a")!.degree).toBe(2); // 2 outbound listed
  expect(g.nodes.find((n) => n.id === "b")!.degree).toBe(1);
});

it("deduplicates links when outbound contains the same target more than once", () => {
  const pages = [
    { id: "a", type: "concept", wiki: "w", title: "", summary: "", tags: [], status: "active", updated: "", path: "p/a.md" },
    { id: "b", type: "concept", wiki: "w", title: "", summary: "", tags: [], status: "active", updated: "", path: "p/b.md" },
  ];
  const links = { a: { outbound: ["b", "b"], inbound: [] }, b: { outbound: [], inbound: ["a"] } };
  const g = buildGraph(pages, links);
  expect(g.links).toEqual([{ source: "a", target: "b" }]);
  expect(g.links).toHaveLength(1);
});

it("returns empty nodes and links for empty inputs", () => {
  const g = buildGraph([], {});
  expect(g.nodes).toEqual([]);
  expect(g.links).toEqual([]);
});

it("skips a links entry whose id is not in pages without throwing", () => {
  const pages = [
    { id: "a", type: "concept", wiki: "w", title: "", summary: "", tags: [], status: "active", updated: "", path: "p/a.md" },
  ];
  // "orphan" is in links but not in pages — must be silently skipped
  const links = { a: { outbound: [], inbound: [] }, orphan: { outbound: ["a"], inbound: [] } };
  expect(() => buildGraph(pages, links)).not.toThrow();
  const g = buildGraph(pages, links);
  expect(g.links).toEqual([]);
});

it("does not throw on a self-loop and emits at most one self-loop link", () => {
  const pages = [
    { id: "a", type: "concept", wiki: "w", title: "", summary: "", tags: [], status: "active", updated: "", path: "p/a.md" },
  ];
  const links = { a: { outbound: ["a"], inbound: ["a"] } };
  expect(() => buildGraph(pages, links)).not.toThrow();
  const g = buildGraph(pages, links);
  expect(g.links).toEqual([{ source: "a", target: "a" }]);
});
