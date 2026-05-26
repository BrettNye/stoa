import { it, expect, vi, afterEach } from "vitest";
import { loadStatic, loadServed, IndexUnavailableError } from "./load.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("normalizes static index fetches and throws a typed error on 404", async () => {
  const pages = { pages: [{ id: "a", type: "concept", wiki: "w", path: "p/a.md" }] };
  const links = { a: { outbound: [], inbound: [] } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (u: string) => ({
      ok: true,
      json: async () => (u.includes("pages") ? pages : links),
    }))
  );
  expect((await loadStatic()).nodes[0].id).toBe("a");

  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
  await expect(loadStatic()).rejects.toBeInstanceOf(IndexUnavailableError);
});

it("loadServed returns the graph as-is from /graph/data", async () => {
  const graph = {
    nodes: [{ id: "b", wiki: "w", type: "concept", title: "", summary: "", tags: [], status: "draft", updated: "", path: "p/b.md", degree: 0 }],
    links: [],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => graph,
    }))
  );
  const result = await loadServed();
  expect(result.nodes[0].id).toBe("b");
  expect(result.links).toHaveLength(0);
});

it("loadServed throws IndexUnavailableError on non-ok response", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
  await expect(loadServed()).rejects.toBeInstanceOf(IndexUnavailableError);
});
