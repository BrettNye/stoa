import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reindex } from "../../src/core/reindex.js";

let vault: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-reidx-"));
  mkdirSync(join(vault, "wikis", "alpha", "concepts"), { recursive: true });
  mkdirSync(join(vault, "_index"), { recursive: true });
  writeFileSync(join(vault, "wikis", "alpha", "CLAUDE.md"), "# alpha\n\nmode: idea-map\nscope: test\n");
  writeFileSync(join(vault, "wikis", "alpha", "map.md"), "---\nid: map-alpha\ntype: map\ntitle: Alpha\ncreated: 2026-04-28\n---\nMap.\n");
  writeFileSync(join(vault, "wikis", "alpha", "concepts", "concept-foo.md"), `---
id: concept-foo
title: Foo
type: concept
wiki: alpha
status: active
created: 2026-04-28
updated: 2026-04-28
summary: A foo concept
tags: [x]
related:
  - "[[wikis/alpha/concepts/concept-bar]]"
---
Body about foo.
`);
  writeFileSync(join(vault, "wikis", "alpha", "concepts", "concept-bar.md"), `---
id: concept-bar
title: Bar
type: concept
wiki: alpha
status: active
created: 2026-04-28
updated: 2026-04-28
summary: A bar concept
tags: [y]
---
Body about bar.
`);
});

describe("reindex", () => {
  it("creates _index/wikis.json with discovered wikis", () => {
    reindex(vault);
    const wikis = JSON.parse(readFileSync(join(vault, "_index", "wikis.json"), "utf8"));
    expect(wikis.wikis).toHaveLength(1);
    expect(wikis.wikis[0].name).toBe("alpha");
  });

  it("creates _index/pages.json with all pages", () => {
    reindex(vault);
    const pages = JSON.parse(readFileSync(join(vault, "_index", "pages.json"), "utf8"));
    expect(pages.pages.map((p: any) => p.id).sort()).toEqual(["concept-bar", "concept-foo", "map-alpha"]);
  });

  it("creates _index/links.json with forward + inbound edges", () => {
    reindex(vault);
    const links = JSON.parse(readFileSync(join(vault, "_index", "links.json"), "utf8"));
    expect(links["concept-foo"].outbound).toContain("concept-bar");
    expect(links["concept-bar"].inbound).toContain("concept-foo");
  });

  it("creates _index/tokens.json with stemmed tokens per page", () => {
    reindex(vault);
    const tokens = JSON.parse(readFileSync(join(vault, "_index", "tokens.json"), "utf8"));
    expect(tokens["concept-foo"].title.length).toBeGreaterThan(0);
    expect(tokens["concept-foo"].body.length).toBeGreaterThan(0);
  });
});
