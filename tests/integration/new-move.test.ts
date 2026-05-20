import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { newMoveTool } from "../../src/tools/new-move.js";
import { parseFrontmatter } from "../../src/core/frontmatter.js";
import { loadIndex } from "../../src/core/index.js";
import { reindex } from "../../src/core/reindex.js";

describe("vault_new-move (integration)", () => {
  let vault: string;

  beforeEach(async () => {
    vault = mkdtempSync(join(tmpdir(), "vault-newmove-int-"));
    mkdirSync(join(vault, "wikis", "_agents", "moves"), { recursive: true });
    mkdirSync(join(vault, "_index"), { recursive: true });
    writeFileSync(join(vault, "_index", "aliases.json"), "{}");
    await reindex(vault);
  });

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
  });

  it("writes a SKILL.md file under wikis/<wiki>/moves/<id>/", async () => {
    const r = await newMoveTool.handler(
      {
        title: "Refactor Loop",
        wiki: "_agents",
        description: "Use when refactoring code in tight feedback loops."
      },
      { vaultPath: vault }
    );
    const expectedPath = join(vault, "wikis", "_agents", "moves", "move-refactor-loop", "SKILL.md");
    expect(existsSync(expectedPath)).toBe(true);
    expect(r.skill_md_path).toBe(expectedPath);
  });

  it("pre-fills v1.5 substrate frontmatter fields (SKILL.md open standard + vault-specific)", async () => {
    const r = await newMoveTool.handler(
      {
        title: "Refactor Loop",
        wiki: "_agents",
        description: "Use when refactoring code in tight feedback loops.",
        move_type: "process",
        applies_to: ["claude-code"],
        pokemon_type: "fire",
        tools_used: ["Edit", "Read"]
      },
      { vaultPath: vault }
    );
    const raw = readFileSync(r.path, "utf8");
    const { frontmatter } = parseFrontmatter(raw);

    // Vault-canonical fields
    expect(frontmatter.id).toBe("move-refactor-loop");
    expect(frontmatter.type).toBe("move");
    expect(frontmatter.wiki).toBe("_agents");
    expect(frontmatter.status).toBe("draft");

    // SKILL.md open-standard fields
    expect(frontmatter.name).toBe("refactor-loop");
    expect(frontmatter.description).toBe("Use when refactoring code in tight feedback loops.");

    // Vault substrate-specific fields
    expect(frontmatter.move_type).toBe("process");
    expect(frontmatter.applies_to).toEqual(["claude-code"]);
    expect(frontmatter.pokemon_type).toBe("fire");
    expect(frontmatter.tools_used).toEqual(["Edit", "Read"]);
  });

  it("body contains the standard SKILL.md headings as placeholders", async () => {
    const r = await newMoveTool.handler(
      {
        title: "Refactor Loop",
        wiki: "_agents",
        description: "Use when refactoring code in tight feedback loops."
      },
      { vaultPath: vault }
    );
    const raw = readFileSync(r.path, "utf8");
    const { body } = parseFrontmatter(raw);
    expect(body).toMatch(/## When to use/);
    expect(body).toMatch(/## How to apply/);
  });

  it("uses an explicit name when given, else derives from title slug", async () => {
    const r1 = await newMoveTool.handler(
      {
        title: "Some Title",
        wiki: "_agents",
        description: "d",
        name: "explicit-name"
      },
      { vaultPath: vault }
    );
    const raw1 = readFileSync(r1.path, "utf8");
    expect(parseFrontmatter(raw1).frontmatter.name).toBe("explicit-name");

    const r2 = await newMoveTool.handler(
      {
        title: "Another Title",
        wiki: "_agents",
        description: "d"
      },
      { vaultPath: vault }
    );
    const raw2 = readFileSync(r2.path, "utf8");
    expect(parseFrontmatter(raw2).frontmatter.name).toBe("another-title");
  });

  it("makes the new move immediately visible via loadIndex (write-through)", async () => {
    const r = await newMoveTool.handler(
      {
        title: "Visible Move",
        wiki: "_agents",
        description: "must appear in pages.json without reindex"
      },
      { vaultPath: vault }
    );
    const idx = loadIndex(vault);
    expect(idx.pages.some(p => p.id === r.id && p.type === "move")).toBe(true);
  });

  it("omits optional fields when not provided (no empty pokemon_type)", async () => {
    const r = await newMoveTool.handler(
      {
        title: "No Type Move",
        wiki: "_agents",
        description: "no pokemon_type"
      },
      { vaultPath: vault }
    );
    const raw = readFileSync(r.path, "utf8");
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.pokemon_type).toBeUndefined();
  });
});
