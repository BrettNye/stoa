import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reindex } from "../../src/core/reindex.js";
import { loadIndex } from "../../src/core/index.js";
import {
  runRegisteredChecks,
  type LintCheckCtx,
} from "../../src/core/lint-check.js";
import type { LintInput, Diagnostic } from "../../src/core/lint.js";

// Wave 3 / Phase-1 T3-4a — registry-backed CROSS_WIKI_LINK_BROKEN check.
// Walks each indexed page's body + `related:` frontmatter, surfaces every
// vault-root absolute wikilink whose <wiki> is unknown or whose <id> is not
// in the index. Code-fenced wikilinks are ignored (extractor strips them).
//
// Tests invoke `runRegisteredChecks` directly (not the `lint()` function in
// core/lint.ts, which only runs the legacy inline checks) — same pattern as
// tests/unit/lint-check-stubs.test.ts.

let vault: string;

function writeMap(wiki: string) {
  writeFileSync(join(vault, "wikis", wiki, "map.md"), `---
id: map-${wiki}
title: ${wiki}
type: map
wiki: ${wiki}
status: active
created: 2026-04-30
updated: 2026-04-30
summary: m
---
m
`);
}

function writePage(wiki: string, type: string, id: string, body: string, related?: string[]) {
  const dir = join(vault, "wikis", wiki, `${type}s`);
  mkdirSync(dir, { recursive: true });
  const fmRelated = related && related.length > 0
    ? `related:\n${related.map(r => `  - "${r}"`).join("\n")}\n`
    : "";
  writeFileSync(join(dir, `${id}.md`), `---
id: ${id}
title: ${id}
type: ${type}
wiki: ${wiki}
status: active
created: 2026-04-30
updated: 2026-04-30
summary: s
${fmRelated}---
${body}
`);
}

function runCheck(): Diagnostic[] {
  const idx = loadIndex(vault);
  const ctx: LintCheckCtx = { vaultPath: vault };
  const input: LintInput = {};
  const out = runRegisteredChecks(ctx, idx, input);
  return out.filter(d => d.code === "CROSS_WIKI_LINK_BROKEN");
}

beforeAll(async () => {
  // Side-effect import to register the check.
  await import("../../src/core/lint-checks/cross-wiki-link-broken.js");
});

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-lint-cwlb-"));
  mkdirSync(join(vault, "wikis", "foo", "concepts"), { recursive: true });
  mkdirSync(join(vault, "wikis", "bar", "concepts"), { recursive: true });
  mkdirSync(join(vault, "_index"), { recursive: true });
  writeMap("foo");
  writeMap("bar");
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

describe("CROSS_WIKI_LINK_BROKEN", () => {
  it("clean: page A in foo links to existing page B in bar — no diagnostic", () => {
    writePage("bar", "concept", "concept-b", "B body");
    writePage("foo", "concept", "concept-a", "Link to [[wikis/bar/concept/concept-b|B]] here.");
    reindex(vault);
    expect(runCheck()).toEqual([]);
  });

  it("missing target id: link to wikis/bar/concept/concept-b when concept-b is absent — flagged", () => {
    // bar wiki exists, but concept-b does NOT
    writePage("foo", "concept", "concept-a", "Link to [[wikis/bar/concept/concept-b]] here.");
    reindex(vault);
    const broken = runCheck();
    expect(broken.length).toBe(1);
    expect(broken[0].severity).toBe("error");
    expect(broken[0].page_id).toBe("concept-a");
    expect(broken[0].wiki).toBe("foo");
    expect(broken[0].message).toContain("concept-b");
    expect(broken[0].message).toMatch(/unknown id/i);
  });

  it("missing target wiki: link to wikis/nonexistent/... — flagged with 'unknown wiki'", () => {
    writePage("foo", "concept", "concept-a", "Link to [[wikis/nonexistent/concept/concept-x]] here.");
    reindex(vault);
    const broken = runCheck();
    expect(broken.length).toBe(1);
    expect(broken[0].severity).toBe("error");
    expect(broken[0].page_id).toBe("concept-a");
    expect(broken[0].message).toMatch(/unknown wiki/i);
    expect(broken[0].message).toContain("nonexistent");
  });

  it("ignores wikilinks inside fenced code blocks", () => {
    const body = [
      "Outside is fine.",
      "",
      "```",
      "[[wikis/nonexistent/concept/concept-x]]",
      "[[wikis/bar/concept/concept-missing]]",
      "```",
      "",
      "Done.",
    ].join("\n");
    writePage("foo", "concept", "concept-a", body);
    reindex(vault);
    expect(runCheck()).toEqual([]);
  });

  it("flags broken link in frontmatter related: with frontmatter source noted", () => {
    writePage("foo", "concept", "concept-a", "body", ["[[wikis/bar/concept/concept-ghost]]"]);
    reindex(vault);
    const broken = runCheck();
    expect(broken.length).toBe(1);
    expect(broken[0].page_id).toBe("concept-a");
    expect(broken[0].message).toContain("concept-ghost");
    expect(broken[0].message).toMatch(/frontmatter/i);
  });

  it("emits separate diagnostics for multiple broken links on the same page", () => {
    const body = "Bad wiki [[wikis/nonexistent/concept/concept-x]] and bad id [[wikis/bar/concept/concept-missing]].";
    writePage("foo", "concept", "concept-a", body);
    reindex(vault);
    const broken = runCheck();
    expect(broken.length).toBe(2);
    expect(broken.every(d => d.page_id === "concept-a")).toBe(true);
    const messages = broken.map(d => d.message).join(" | ");
    expect(messages).toMatch(/unknown wiki/i);
    expect(messages).toMatch(/unknown id/i);
  });
});
