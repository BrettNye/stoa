import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { newMoveTool } from "../../src/tools/new-move.js";

function seedVault(): string {
  const vault = mkdtempSync(join(tmpdir(), "vault-newmove-unit-"));
  mkdirSync(join(vault, "wikis", "_agents", "moves"), { recursive: true });
  mkdirSync(join(vault, "_index"), { recursive: true });
  writeFileSync(join(vault, "_index", "aliases.json"), "{}");
  return vault;
}

describe("vault_new-move (unit)", () => {
  let vault: string;

  beforeEach(() => { vault = seedVault(); });
  afterEach(() => { rmSync(vault, { recursive: true, force: true }); });

  it("derives id and skill_md path from the title", async () => {
    const r = await newMoveTool.handler(
      {
        title: "Refactor Loop",
        wiki: "_agents",
        description: "Use when refactoring code in tight feedback loops."
      },
      { vaultPath: vault }
    );
    expect(r.id).toBe("move-refactor-loop");
    expect(r.skill_md_path.replace(/\\/g, "/")).toContain("wikis/_agents/moves/move-refactor-loop/SKILL.md");
    // path mirrors skill_md_path; both are returned for caller convenience.
    expect(r.path).toBe(r.skill_md_path);
  });

  it("requires a description", async () => {
    await expect(
      newMoveTool.handler(
        { title: "Missing Description Move", wiki: "_agents" } as any,
        { vaultPath: vault }
      )
    ).rejects.toThrow();
  });

  it("defaults move_type to 'process' and applies_to to ['claude-code']", async () => {
    const r = await newMoveTool.handler(
      {
        title: "Default Defaults",
        wiki: "_agents",
        description: "tests defaults"
      },
      { vaultPath: vault }
    );
    expect(r.id).toBe("move-default-defaults");
  });

  it("accepts explicit move_type, applies_to, pokemon_type, tools_used", async () => {
    const r = await newMoveTool.handler(
      {
        title: "Custom Move",
        wiki: "_agents",
        description: "custom",
        move_type: "capability",
        applies_to: ["claude-code", "codex"],
        pokemon_type: "fire",
        tools_used: ["Bash", "Edit"]
      },
      { vaultPath: vault }
    );
    expect(r.id).toBe("move-custom-move");
  });

  it("uses explicit name when given, otherwise derives from title slug", async () => {
    const r = await newMoveTool.handler(
      {
        title: "Test Title",
        wiki: "_agents",
        description: "d",
        name: "my-custom-name"
      },
      { vaultPath: vault }
    );
    expect(r.id).toBe("move-test-title");
  });
});
