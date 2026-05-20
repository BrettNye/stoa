import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { syncSkillsTool } from "../../src/tools/sync-skills.js";

describe("vault_sync-skills", () => {
  let vaultPath: string;
  let repoPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-ss-"));
    repoPath = mkdtempSync(join(tmpdir(), "repo-ss-"));

    const profilesDir = join(vaultPath, "wikis", "_agents", "profiles");
    mkdirSync(profilesDir, { recursive: true });
    writeFileSync(join(profilesDir, "profile-charmander.md"),
      `---
id: profile-charmander
type: profile
title: Charmander
created: 2026-04-29
wiki: _agents
status: active
summary: x
pokemon_type: fire
evolution_stage: basic
moveset: [move-tdd-cycle]
applies_to: [claude-code]
---

# Charmander
`);

    const moveDir = join(vaultPath, "wikis", "_agents", "moves", "move-tdd-cycle");
    mkdirSync(moveDir, { recursive: true });
    writeFileSync(join(moveDir, "SKILL.md"),
      `---
id: move-tdd-cycle
type: move
title: TDD
created: 2026-04-29
name: tdd-cycle
description: x
applies_to: [claude-code]
---

# TDD
`);
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    rmSync(repoPath, { recursive: true, force: true });
  });

  it("syncs Pokemon's moveset to claude-code skills dir", async () => {
    const result = await syncSkillsTool.handler(
      { repo_path: repoPath, pokemon: "profile-charmander", target: "claude-code", mode: "copy" },
      { vaultPath }
    );
    expect(result.moves_synced).toEqual(["move-tdd-cycle"]);
    expect(existsSync(join(repoPath, ".claude", "skills", "charmander", "move-tdd-cycle", "SKILL.md"))).toBe(true);
  });
});
