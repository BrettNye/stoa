import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reindex } from "../../src/core/reindex.js";
import { rewriteLinksTool } from "../../src/tools/rewrite-links.js";

let vault: string;

/**
 * Phase-2 T3-5 — `vault.rewrite-links` integration tests.
 *
 * Each test seeds a fixture vault with pages whose body and/or frontmatter
 * `related:` carry `wikis/rastate/concept/...` wikilinks, then exercises the
 * rewrite tool through its handler (same path the MCP server takes).
 *
 * The fixture uses two wikis (`alpha`, `_meta`) so reindex doesn't barf on a
 * missing tree, but the wikilinks themselves point at a synthetic
 * `wikis/rastate/...` prefix — we never resolve them, only rewrite them.
 */
function seedVault(): string {
  const v = mkdtempSync(join(tmpdir(), "vault-rwl-"));
  // Two real wikis so reindex has something to discover.
  mkdirSync(join(v, "wikis", "alpha", "concepts"), { recursive: true });
  mkdirSync(join(v, "_index"), { recursive: true });
  writeFileSync(
    join(v, "wikis", "alpha", "CLAUDE.md"),
    "# alpha\n\n**Mode:** idea-map\n**Scope:** test\n"
  );
  writeFileSync(
    join(v, "wikis", "alpha", "map.md"),
    "---\nid: map-alpha\ntype: map\ntitle: Alpha\ncreated: 2026-04-30\n---\nMap.\n"
  );
  return v;
}

function writeConcept(
  vaultPath: string,
  wiki: string,
  id: string,
  body: string,
  related?: string[]
) {
  const dir = join(vaultPath, "wikis", wiki, "concepts");
  mkdirSync(dir, { recursive: true });
  const fm = [
    "---",
    `id: ${id}`,
    `title: ${id}`,
    "type: concept",
    `wiki: ${wiki}`,
    "status: active",
    "created: 2026-04-30",
    "updated: 2026-04-30",
    `summary: a ${id} concept`,
    "tags: []"
  ];
  if (related && related.length > 0) {
    fm.push("related:");
    for (const r of related) fm.push(`  - "${r}"`);
  }
  fm.push("---");
  writeFileSync(join(dir, `${id}.md`), `${fm.join("\n")}\n${body}\n`);
}

describe("phase-2 T3-5 — vault.rewrite-links tool", () => {
  beforeEach(() => {
    vault = seedVault();
  });

  it("dry-run: reports modified pages but writes nothing and skips reindex", async () => {
    writeConcept(vault, "alpha", "concept-foo-1", "See [[wikis/rastate/concept/foo]].");
    writeConcept(vault, "alpha", "concept-foo-2", "Refs [[wikis/rastate/concept/bar]].");
    writeConcept(vault, "alpha", "concept-foo-3", "Or [[wikis/rastate/concept/baz]].");
    reindex(vault);

    const before1 = readFileSync(join(vault, "wikis", "alpha", "concepts", "concept-foo-1.md"), "utf8");
    const before2 = readFileSync(join(vault, "wikis", "alpha", "concepts", "concept-foo-2.md"), "utf8");
    const before3 = readFileSync(join(vault, "wikis", "alpha", "concepts", "concept-foo-3.md"), "utf8");

    const result = await rewriteLinksTool.handler(
      {
        from_prefix: "wikis/rastate/concept/",
        to_prefix: "wikis/rastate-core/concept/",
        dry_run: true,
        scopes: ["all"]
      },
      { vaultPath: vault }
    );

    expect(result.pages_modified).toHaveLength(3);
    expect(result.total_links).toBe(3);
    expect(result.reindex_run).toBe(false);

    // Files unchanged on disk.
    expect(readFileSync(join(vault, "wikis", "alpha", "concepts", "concept-foo-1.md"), "utf8")).toBe(before1);
    expect(readFileSync(join(vault, "wikis", "alpha", "concepts", "concept-foo-2.md"), "utf8")).toBe(before2);
    expect(readFileSync(join(vault, "wikis", "alpha", "concepts", "concept-foo-3.md"), "utf8")).toBe(before3);

    // Each page contributes exactly one rewrite.
    const ids = result.pages_modified.map(p => p.page_id).sort();
    expect(ids).toEqual(["concept-foo-1", "concept-foo-2", "concept-foo-3"]);
    for (const p of result.pages_modified) expect(p.links_rewritten).toBe(1);
  });

  it("non-dry-run: writes files, reindexes, and reflects new prefix on subsequent reads", async () => {
    writeConcept(vault, "alpha", "concept-foo-1", "See [[wikis/rastate/concept/foo]].");
    writeConcept(vault, "alpha", "concept-foo-2", "Refs [[wikis/rastate/concept/bar]].");
    writeConcept(vault, "alpha", "concept-foo-3", "Or [[wikis/rastate/concept/baz]].");
    reindex(vault);

    const result = await rewriteLinksTool.handler(
      {
        from_prefix: "wikis/rastate/concept/",
        to_prefix: "wikis/rastate-core/concept/",
        dry_run: false,
        scopes: ["all"]
      },
      { vaultPath: vault }
    );

    expect(result.pages_modified).toHaveLength(3);
    expect(result.total_links).toBe(3);
    expect(result.reindex_run).toBe(true);

    const after1 = readFileSync(join(vault, "wikis", "alpha", "concepts", "concept-foo-1.md"), "utf8");
    expect(after1).toContain("[[wikis/rastate-core/concept/foo]]");
    expect(after1).not.toContain("[[wikis/rastate/concept/foo]]");

    // Reindex side-effect: pages.json carries refreshed last-touched data
    // (we can't verify a rewrite-target that lives in another wiki because
    // `extractWikilinks` collapses targets to their last segment, but the
    // index files exist + are non-empty after the rewrite ran). The body
    // assertions above are the load-bearing check; this just smoke-tests
    // that reindex did fire.
    const pages = JSON.parse(readFileSync(join(vault, "_index", "pages.json"), "utf8"));
    expect(pages.pages.length).toBeGreaterThan(0);
  });

  it("idempotency: second non-dry-run with same args is a no-op", async () => {
    writeConcept(vault, "alpha", "concept-foo-1", "See [[wikis/rastate/concept/foo]].");
    reindex(vault);

    await rewriteLinksTool.handler(
      {
        from_prefix: "wikis/rastate/concept/",
        to_prefix: "wikis/rastate-core/concept/",
        dry_run: false,
        scopes: ["all"]
      },
      { vaultPath: vault }
    );

    const second = await rewriteLinksTool.handler(
      {
        from_prefix: "wikis/rastate/concept/",
        to_prefix: "wikis/rastate-core/concept/",
        dry_run: false,
        scopes: ["all"]
      },
      { vaultPath: vault }
    );

    expect(second.pages_modified).toEqual([]);
    expect(second.total_links).toBe(0);
    // No rewrites means no reindex needed.
    expect(second.reindex_run).toBe(false);
  });

  it("scope filter ['body']: rewrites body but leaves frontmatter related: untouched", async () => {
    writeConcept(
      vault,
      "alpha",
      "concept-mixed",
      "Body link [[wikis/rastate/concept/foo]].",
      ["[[wikis/rastate/concept/bar]]"]
    );
    reindex(vault);

    const result = await rewriteLinksTool.handler(
      {
        from_prefix: "wikis/rastate/concept/",
        to_prefix: "wikis/rastate-core/concept/",
        dry_run: false,
        scopes: ["body"]
      },
      { vaultPath: vault }
    );

    expect(result.total_links).toBe(1);
    const after = readFileSync(join(vault, "wikis", "alpha", "concepts", "concept-mixed.md"), "utf8");
    // Body rewritten.
    expect(after).toContain("[[wikis/rastate-core/concept/foo]]");
    // Frontmatter related untouched.
    expect(after).toContain("[[wikis/rastate/concept/bar]]");
    expect(after).not.toContain("[[wikis/rastate-core/concept/bar]]");
  });

  it("scope filter ['frontmatter']: rewrites related but leaves body untouched", async () => {
    writeConcept(
      vault,
      "alpha",
      "concept-mixed-fm",
      "Body link [[wikis/rastate/concept/foo]].",
      ["[[wikis/rastate/concept/bar]]"]
    );
    reindex(vault);

    const result = await rewriteLinksTool.handler(
      {
        from_prefix: "wikis/rastate/concept/",
        to_prefix: "wikis/rastate-core/concept/",
        dry_run: false,
        scopes: ["frontmatter"]
      },
      { vaultPath: vault }
    );

    expect(result.total_links).toBe(1);
    const after = readFileSync(join(vault, "wikis", "alpha", "concepts", "concept-mixed-fm.md"), "utf8");
    // Frontmatter rewritten.
    expect(after).toContain("[[wikis/rastate-core/concept/bar]]");
    // Body untouched.
    expect(after).toContain("[[wikis/rastate/concept/foo]]");
    expect(after).not.toContain("[[wikis/rastate-core/concept/foo]]");
  });

  it("code-fence skip: wikilinks inside ```typescript ... ``` blocks are NOT rewritten", async () => {
    const fencedBody = [
      "Free-floating [[wikis/rastate/concept/free]] should rewrite.",
      "",
      "```typescript",
      "// Inside fence: [[wikis/rastate/concept/fenced]] must NOT rewrite.",
      "```",
      ""
    ].join("\n");
    writeConcept(vault, "alpha", "concept-fenced", fencedBody);
    reindex(vault);

    const result = await rewriteLinksTool.handler(
      {
        from_prefix: "wikis/rastate/concept/",
        to_prefix: "wikis/rastate-core/concept/",
        dry_run: false,
        scopes: ["body"]
      },
      { vaultPath: vault }
    );

    expect(result.total_links).toBe(1);
    const after = readFileSync(join(vault, "wikis", "alpha", "concepts", "concept-fenced.md"), "utf8");
    // The free-floating link rewritten.
    expect(after).toContain("[[wikis/rastate-core/concept/free]]");
    // The fenced link preserved verbatim.
    expect(after).toContain("[[wikis/rastate/concept/fenced]]");
    expect(after).not.toContain("[[wikis/rastate-core/concept/fenced]]");
  });
});
