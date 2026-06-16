import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { syncTool } from "../../src/tools/sync.js";

function writeProfile(vaultPath: string, id: string, pokemon_type: string) {
  const profilesDir = join(vaultPath, "wikis", "_agents", "profiles");
  mkdirSync(profilesDir, { recursive: true });
  writeFileSync(join(profilesDir, `${id}.md`),
    `---
id: ${id}
type: profile
title: ${id}
created: 2026-05-12
wiki: _agents
status: active
summary: x
pokemon_type: ${pokemon_type}
evolution_stage: basic
moveset: []
applies_to: [claude-code]
---
# ${id}
`);
}

describe("vault_sync surface=agents --all integration", () => {
  let vaultPath: string;
  let target: string;
  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-sa-all-"));
    target = mkdtempSync(join(tmpdir(), "repo-sa-all-"));
    mkdirSync(join(vaultPath, "wikis", "_agents", "profiles"), { recursive: true });
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    writeFileSync(join(vaultPath, "_index", "deployments.json"), "{}");
  });
  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  });

  it("deploys every profile when all: true", async () => {
    writeProfile(vaultPath, "profile-squirtle", "water");
    writeProfile(vaultPath, "profile-charmander", "fire");

    const result = await syncTool.handler(
      { surface: "agents", all: true, repo_path: target, runtime: "claude-code", mode: "copy", overwrite: true, exclude: [], pokemon_type: [], include_moveset: false } as any,
      { vaultPath }
    );

    expect(result.summary.requested).toBe(2);
    expect(result.summary.deployed).toBe(2);
    expect(existsSync(join(target, ".claude", "agents", "profile-squirtle.md"))).toBe(true);
    expect(existsSync(join(target, ".claude", "agents", "profile-charmander.md"))).toBe(true);
  });

  it("applies exclude under all: true", async () => {
    writeProfile(vaultPath, "profile-squirtle", "water");
    writeProfile(vaultPath, "profile-charmander", "fire");

    const result = await syncTool.handler(
      { surface: "agents", all: true, repo_path: target, runtime: "claude-code", mode: "copy", overwrite: true, exclude: ["charmander"], pokemon_type: [], include_moveset: false } as any,
      { vaultPath }
    );

    expect(result.summary.requested).toBe(1);
    expect(result.summary.deployed).toBe(1);
    expect(existsSync(join(target, ".claude", "agents", "profile-charmander.md"))).toBe(false);
  });

  it("returns empty success when --all matches no profiles", async () => {
    const result = await syncTool.handler(
      { surface: "agents", all: true, repo_path: target, runtime: "claude-code", mode: "copy", overwrite: true, exclude: [], pokemon_type: ["dragon"], include_moveset: false } as any,
      { vaultPath }
    );

    expect(result.summary).toEqual({ requested: 0, deployed: 0, skipped: 0, failed: 0 });
    expect(result.results).toEqual([]);
  });

  it("continues on error when continue_on_error: true under all", async () => {
    writeProfile(vaultPath, "profile-squirtle", "water");
    const profilesDir = join(vaultPath, "wikis", "_agents", "profiles");
    // Empty applies_to triggers invariant 3 failure in claude-code adapter.validate.
    writeFileSync(join(profilesDir, "profile-broken.md"),
      `---\nid: profile-broken\ntype: profile\ntitle: profile-broken\ncreated: 2026-05-12\nwiki: _agents\nstatus: active\nsummary: x\npokemon_type: fire\nevolution_stage: basic\nmoveset: []\napplies_to: []\n---\n`);

    const result = await syncTool.handler(
      { surface: "agents", all: true, repo_path: target, runtime: "claude-code", mode: "copy", overwrite: true, exclude: [], pokemon_type: [], include_moveset: false, continue_on_error: true } as any,
      { vaultPath }
    );

    expect(result.summary.deployed).toBe(1);
    expect(result.summary.failed).toBe(1);
    expect(existsSync(join(target, ".claude", "agents", "profile-squirtle.md"))).toBe(true);
  });
});
