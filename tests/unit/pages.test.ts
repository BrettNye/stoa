import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathForPage, readPage, writePage } from "../../src/core/pages.js";

describe("v1.5 — move directory layout", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-pages-v15-"));
    mkdirSync(join(vaultPath, "wikis", "_agents", "moves"), { recursive: true });
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("pathForPage on a move returns <wiki>/moves/<id>/SKILL.md", () => {
    const p = pathForPage(vaultPath, "move-tdd-cycle", "move", "_agents");
    expect(p).toBe(join(vaultPath, "wikis", "_agents", "moves", "move-tdd-cycle", "SKILL.md"));
  });

  it("pathForPage on a profile returns single .md file", () => {
    const p = pathForPage(vaultPath, "profile-charmander", "profile", "_agents");
    expect(p).toBe(join(vaultPath, "wikis", "_agents", "profiles", "profile-charmander.md"));
  });

  it("writePage on a move creates the directory + SKILL.md", () => {
    writePage(vaultPath, {
      id: "move-tdd-cycle", type: "move", wiki: "_agents",
      frontmatter: {
        id: "move-tdd-cycle", type: "move", title: "TDD cycle",
        created: "2026-04-29", name: "tdd-cycle",
        description: "Use when implementing"
      },
      body: "# TDD cycle\n\n..."
    });
    const expected = join(vaultPath, "wikis", "_agents", "moves", "move-tdd-cycle", "SKILL.md");
    expect(readFileSync(expected, "utf8")).toContain("# TDD cycle");
  });

  it("readPage on a move reads from <id>/SKILL.md", () => {
    const dir = join(vaultPath, "wikis", "_agents", "moves", "move-tdd-cycle");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"),
      "---\nid: move-tdd-cycle\ntype: move\ntitle: TDD\ncreated: 2026-04-29\nname: tdd-cycle\ndescription: x\n---\n\nbody");
    const result = readPage(vaultPath, "move-tdd-cycle", "_agents");
    expect(result.frontmatter.type).toBe("move");
    expect(result.body.trim()).toBe("body");
  });
});
