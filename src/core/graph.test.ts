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
