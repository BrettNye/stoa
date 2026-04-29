import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bootstrapRepoTool } from "../../src/tools/bootstrap-repo.js";

describe("integration — bootstrap-repo with profile + moveset", () => {
  let vaultPath: string;
  let repoPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-int-br-"));
    repoPath = mkdtempSync(join(tmpdir(), "repo-int-br-"));

    mkdirSync(join(vaultPath, "wikis", "alpha"), { recursive: true });
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
summary: Backend
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

  it("end-to-end bootstrap with profile deploys .mcp.json + CLAUDE.md + skills", async () => {
    const r = await bootstrapRepoTool.handler({
      repo_path: repoPath, wiki: "alpha", pokemon: "profile-charmander",
      channels: ["alpha-progress"]
    }, { vaultPath });

    expect(existsSync(join(repoPath, ".mcp.json"))).toBe(true);
    expect(existsSync(join(repoPath, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(repoPath, ".claude", "skills", "charmander", "move-tdd-cycle", "SKILL.md"))).toBe(true);

    const claudeMd = readFileSync(join(repoPath, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain("Charmander");
    expect(claudeMd).toContain("alpha-progress");

    expect(r.moveset_synced?.moves).toEqual(["move-tdd-cycle"]);
  });
});
