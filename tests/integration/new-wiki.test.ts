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

  // Regression: bug-2026-05-15 #3 — `SUBFOLDERS` in core/wikis.ts was
  // missing `questions`. As a result _meta and meetings wikis (scaffolded
  // pre-fix) lacked questions/, and vault.process-inbox errored ENOENT mid
  // batch when promoting a question item. The fix ensures new-wiki creates
  // every knowledge-type subdirectory upfront so the gap can't recur.
  describe("regression bug-2026-05-15 #3: scaffolds all knowledge-type subdirs", () => {
    it("creates questions/, ideas/, concepts/, decisions/, specs/, synthesis/, guides/, sources/ + tasks/, journal/, inbox/", () => {
      newWiki(vault, {
        name: "scaffold-check",
        mode: "mixed",
        scope: "ensure full subdir scaffold"
      });
      const root = join(vault, "wikis", "scaffold-check");
      // All eight knowledge-type subdirs MUST exist.
      const required = [
        "ideas", "questions", "specs", "decisions",
        "concepts", "guides", "synthesis", "sources",
        // Execution + capture
        "tasks", "journal", "inbox",
      ];
      for (const sub of required) {
        expect(existsSync(join(root, sub)), `missing subdir: ${sub}`).toBe(true);
      }
    });
  });

  it("scaffolded family flows through loadWikiMeta + reindex into _index/wikis.json", async () => {
    // End-to-end: the format new-wiki writes must match the regex
    // loadWikiMeta uses (T2-1) and surface on the wikis.json entry (T2-2).
    newWiki(vault, {
      name: "rastate-mcp",
      mode: "project-doc",
      scope: "rastate mcp surface",
      family: "rastate"
    });
    // Sanity: loadWikiMeta picks up the family field directly from disk.
    // v1.7 §5.7 — loadWikiMeta now also surfaces `mode:` from CLAUDE.md.
    expect(loadWikiMeta(vault, "rastate-mcp")).toEqual({ family: "rastate", mode: "project-doc" });

    // map.md is required so reindex registers the wiki.
    expect(existsSync(join(vault, "wikis", "rastate-mcp", "map.md"))).toBe(true);

    await reindex(vault);
    const wikisIdx = JSON.parse(
      readFileSync(join(vault, "_index", "wikis.json"), "utf8")
    );
    const entry = wikisIdx.wikis.find((w: { name: string }) => w.name === "rastate-mcp");
    expect(entry).toBeDefined();
    expect(entry.family).toBe("rastate");
  });
});
