import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadIndex, queryPages, queryWikis } from "../../src/core/index.js";

let vault: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-idx-"));
  mkdirSync(join(vault, "_index"), { recursive: true });
  writeFileSync(join(vault, "_index", "wikis.json"), JSON.stringify({
    wikis: [{ name: "alpha", mode: "idea-map", scope: "Test", page_counts: {}, last_touched: "2026-04-28" }]
  }));
  writeFileSync(join(vault, "_index", "pages.json"), JSON.stringify({
    pages: [
      { id: "concept-foo", type: "concept", wiki: "alpha", title: "Foo", summary: "a foo", tags: ["x"], status: "active", updated: "2026-04-28", path: "wikis/alpha/concepts/concept-foo.md" },
      { id: "decision-2026-04-28-bar", type: "decision", wiki: "alpha", title: "Bar", summary: "b bar", tags: ["y"], status: "accepted", confidence: "high", updated: "2026-04-28", path: "wikis/alpha/decisions/decision-2026-04-28-bar.md" }
    ]
  }));
  writeFileSync(join(vault, "_index", "links.json"), JSON.stringify({}));
});

describe("loadIndex", () => {
  it("loads wikis + pages + links", () => {
    const idx = loadIndex(vault);
    expect(idx.wikis).toHaveLength(1);
    expect(idx.pages).toHaveLength(2);
  });
});

describe("queryPages", () => {
  it("filters by wiki", () => {
    const idx = loadIndex(vault);
    expect(queryPages(idx, { wiki: "alpha" })).toHaveLength(2);
    expect(queryPages(idx, { wiki: "missing" })).toHaveLength(0);
  });

  it("filters by type", () => {
    const idx = loadIndex(vault);
    expect(queryPages(idx, { type: "concept" })).toHaveLength(1);
  });

  it("filters by layer", () => {
    const idx = loadIndex(vault);
    expect(queryPages(idx, { layer: "knowledge" })).toHaveLength(2);
    expect(queryPages(idx, { layer: "execution" })).toHaveLength(0);
  });
});

describe("queryWikis", () => {
  it("returns all wikis", () => {
    const idx = loadIndex(vault);
    expect(queryWikis(idx)).toHaveLength(1);
  });
});
