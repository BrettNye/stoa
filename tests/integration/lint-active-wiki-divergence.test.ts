import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lintTool } from "../../src/tools/lint.js";

// Wave 3 / Phase-1 T3-4c — registry-backed ACTIVE_WIKI_DIVERGENCE check.
// Surfaces an info-level diagnostic when the per-repo MCP arg
// `--default-wiki=<X>` (carried on the dispatch ctx as ctx.defaultWiki)
// disagrees with the vault-global `.active-wiki` file. Either side missing
// (no --default-wiki, no .active-wiki, or empty file) → no diagnostic.

let vault: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-lint-awd-"));
  // Minimal vault skeleton: _index dir + an _agents wiki with map.md so
  // unrelated MISSING_MAP diagnostics don't pollute these assertions.
  mkdirSync(join(vault, "_index"), { recursive: true });
  mkdirSync(join(vault, "wikis", "_agents"), { recursive: true });
  writeFileSync(join(vault, "wikis", "_agents", "map.md"),
    `---
id: map-_agents
title: agents
type: map
wiki: _agents
status: active
created: 2026-04-30
updated: 2026-04-30
summary: m
---
`);
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

async function runLint(opts: { defaultWiki?: string } = {}) {
  return await lintTool.handler(
    { level: "info" as const },
    { vaultPath: vault, defaultWiki: opts.defaultWiki }
  );
}

describe("ACTIVE_WIKI_DIVERGENCE", () => {
  it("match: ctx.defaultWiki === .active-wiki contents → no diagnostic", async () => {
    writeFileSync(join(vault, ".active-wiki"), "foo\n");
    const r = await runLint({ defaultWiki: "foo" });
    expect(r.diagnostics.some(d => d.code === "ACTIVE_WIKI_DIVERGENCE")).toBe(false);
  });

  it("diverge: ctx.defaultWiki=foo, .active-wiki=bar → one info diagnostic mentioning both", async () => {
    writeFileSync(join(vault, ".active-wiki"), "bar\n");
    const r = await runLint({ defaultWiki: "foo" });
    const hits = r.diagnostics.filter(d => d.code === "ACTIVE_WIKI_DIVERGENCE");
    expect(hits.length).toBe(1);
    expect(hits[0].severity).toBe("info");
    expect(hits[0].message).toContain("foo");
    expect(hits[0].message).toContain("bar");
    // Operator-friendly: should reference the file path so they know where
    // .active-wiki lives.
    expect(hits[0].message).toMatch(/\.active-wiki/);
  });

  it("no defaultWiki: ctx.defaultWiki undefined, .active-wiki=bar → no diagnostic", async () => {
    writeFileSync(join(vault, ".active-wiki"), "bar\n");
    const r = await runLint({ defaultWiki: undefined });
    expect(r.diagnostics.some(d => d.code === "ACTIVE_WIKI_DIVERGENCE")).toBe(false);
  });

  it("no .active-wiki file: ctx.defaultWiki=foo, file missing → no diagnostic", async () => {
    const r = await runLint({ defaultWiki: "foo" });
    expect(r.diagnostics.some(d => d.code === "ACTIVE_WIKI_DIVERGENCE")).toBe(false);
  });

  it("empty/whitespace .active-wiki: treat as unset → no diagnostic", async () => {
    writeFileSync(join(vault, ".active-wiki"), "   \n\n");
    const r = await runLint({ defaultWiki: "foo" });
    expect(r.diagnostics.some(d => d.code === "ACTIVE_WIKI_DIVERGENCE")).toBe(false);
  });
});
