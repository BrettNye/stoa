import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newWiki, loadWikiMeta } from "../../src/core/wikis.js";
import { reindex } from "../../src/core/reindex.js";

let vault: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-newwiki-family-"));
  writeFileSync(join(vault, "REGISTRY.md"), "# Wikis\n\n");
  // reindex needs _index/ to exist as the destination root.
  mkdirSync(join(vault, "_index"), { recursive: true });
});

describe("newWiki --family (Phase-2 T3-1)", () => {
  it("scaffolds CLAUDE.md with the **Family:** line when family is set", () => {
    // Phase-2 T3-1 — the optional family input is rendered into the
    // generated CLAUDE.md using the same `**Family:** <value>` form
    // that loadWikiMeta (T2-1) recognizes.
    newWiki(vault, {
      name: "rastate-core",
      mode: "project-doc",
      scope: "rastate kernel",
      family: "rastate"
    });
    const claudeMd = readFileSync(
      join(vault, "wikis", "rastate-core", "CLAUDE.md"),
      "utf8"
    );
    expect(claudeMd).toMatch(/\*\*Mode:\*\* project-doc/);
    expect(claudeMd).toMatch(/\*\*Family:\*\* rastate/);
  });

  it("omits the Family line when family is not provided (back-compat)", () => {
    // Default behaviour: no family input → no Family line at all. This
    // preserves the pre-Phase-2 scaffold output for single-wiki projects.
    newWiki(vault, {
      name: "newproj",
      mode: "idea-map",
      scope: "for testing"
    });
    const claudeMd = readFileSync(
      join(vault, "wikis", "newproj", "CLAUDE.md"),
      "utf8"
    );
    expect(claudeMd).toMatch(/\*\*Mode:\*\* idea-map/);
    expect(claudeMd).not.toMatch(/\*\*Family:\*\*/i);
    expect(claudeMd).not.toMatch(/^family:/im);
  });

  it("scaffolded family flows through loadWikiMeta + reindex into _index/wikis.json", () => {
    // End-to-end: the format new-wiki writes must match the regex
    // loadWikiMeta uses (T2-1) and surface on the wikis.json entry (T2-2).
    newWiki(vault, {
      name: "rastate-mcp",
      mode: "project-doc",
      scope: "rastate mcp surface",
      family: "rastate"
    });
    // Sanity: loadWikiMeta picks up the family field directly from disk.
    expect(loadWikiMeta(vault, "rastate-mcp")).toEqual({ family: "rastate" });

    // map.md is required so reindex registers the wiki.
    expect(existsSync(join(vault, "wikis", "rastate-mcp", "map.md"))).toBe(true);

    reindex(vault);
    const wikisIdx = JSON.parse(
      readFileSync(join(vault, "_index", "wikis.json"), "utf8")
    );
    const entry = wikisIdx.wikis.find((w: { name: string }) => w.name === "rastate-mcp");
    expect(entry).toBeDefined();
    expect(entry.family).toBe("rastate");
  });
});
