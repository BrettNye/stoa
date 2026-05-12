import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { syncSkillsTool } from "../../src/tools/sync-skills.js";

function writeProfile(vaultPath: string, id: string, pokemon_type: string, moveset: string[] = []) {
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
moveset: [${moveset.join(", ")}]
applies_to: [claude-code]
---
# ${id}
`);
}

function writeMove(vaultPath: string, id: string) {
  const moveDir = join(vaultPath, "wikis", "_agents", "moves", id);
  mkdirSync(moveDir, { recursive: true });
  writeFileSync(join(moveDir, "SKILL.md"),
    `---\nid: ${id}\ntype: move\ntitle: ${id}\ncreated: 2026-05-12\nname: ${id}\ndescription: x\napplies_to: [claude-code]\n---\n# ${id}\n`);
}

describe("sync-skills --all integration", () => {
  let vaultPath: string;
  let repoPath: string;
  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-ss-all-"));
    repoPath = mkdtempSync(join(tmpdir(), "repo-ss-all-"));
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    writeFileSync(join(vaultPath, "_index", "deployments.json"), "{}");
    writeMove(vaultPath, "move-tdd-cycle");
  });
  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    rmSync(repoPath, { recursive: true, force: true });
  });

  it("deploys movesets for every profile when all: true", async () => {
    writeProfile(vaultPath, "profile-squirtle", "water", ["move-tdd-cycle"]);
    writeProfile(vaultPath, "profile-charmander", "fire", ["move-tdd-cycle"]);

    const result: any = await syncSkillsTool.handler(
      { repo_path: repoPath, all: true, exclude: [], pokemon_type: [], reverify: false, fix: false, target: "claude-code", mode: "copy", continue_on_error: false } as any,
      { vaultPath }
    );

    expect(result.summary.deployed).toBe(2);
    expect(result.results).toHaveLength(2);
  });

  it("preserves single-pokemon flat output shape (back-compat)", async () => {
    writeProfile(vaultPath, "profile-squirtle", "water", ["move-tdd-cycle"]);

    const result: any = await syncSkillsTool.handler(
      { repo_path: repoPath, pokemon: "profile-squirtle", reverify: false, fix: false, target: "claude-code", mode: "copy" } as any,
      { vaultPath }
    );

    // Old shape preserved: flat keys, no results array.
    expect(result.skills_dir).toBeDefined();
    expect(result.moves_synced).toBeDefined();
    expect(result.results).toBeUndefined();
  });
});
