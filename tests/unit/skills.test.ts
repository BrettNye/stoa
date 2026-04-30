import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, platform } from "node:os";
import {
  resolveSkillsDir, syncMoveset, SyncResult
} from "../../src/core/skills.js";

describe("resolveSkillsDir", () => {
  it("claude-code → <repo>/.claude/skills/<pokemon>/", () => {
    const r = resolveSkillsDir("/repo", "claude-code", "charmander");
    expect(r).toBe(join("/repo", ".claude", "skills", "charmander"));
  });

  it("openclaw → <repo>/.openclaw/skills/<pokemon>/", () => {
    const r = resolveSkillsDir("/repo", "openclaw", "charmander");
    expect(r).toBe(join("/repo", ".openclaw", "skills", "charmander"));
  });

  it("codex → <repo>/.codex/skills/<pokemon>/", () => {
    const r = resolveSkillsDir("/repo", "codex", "charmander");
    expect(r).toBe(join("/repo", ".codex", "skills", "charmander"));
  });
});

describe("syncMoveset", () => {
  let vaultPath: string;
  let repoPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-skills-"));
    repoPath = mkdtempSync(join(tmpdir(), "repo-skills-"));

    // Create _agents/profiles/profile-charmander.md
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
autonomy_level: restricted
moveset:
  - move-tdd-cycle
  - move-pr-create
applies_to: [claude-code]
---

# Charmander
`);

    // Create _agents/moves/move-tdd-cycle/SKILL.md
    const tddDir = join(vaultPath, "wikis", "_agents", "moves", "move-tdd-cycle");
    mkdirSync(tddDir, { recursive: true });
    writeFileSync(join(tddDir, "SKILL.md"),
      `---
id: move-tdd-cycle
type: move
title: TDD cycle
created: 2026-04-29
name: tdd-cycle
description: Use when implementing
applies_to: [claude-code, openclaw]
---

# TDD
`);

    // move-pr-create
    const prDir = join(vaultPath, "wikis", "_agents", "moves", "move-pr-create");
    mkdirSync(prDir, { recursive: true });
    writeFileSync(join(prDir, "SKILL.md"),
      `---
id: move-pr-create
type: move
title: Create PR
created: 2026-04-29
name: pr-create
description: Use when ready to ship
applies_to: [claude-code]
---

# PR
`);
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    rmSync(repoPath, { recursive: true, force: true });
  });

  it("syncs moves into <repo>/.claude/skills/charmander/<move>/", () => {
    const result: SyncResult = syncMoveset({
      vaultPath, repoPath, pokemon_id: "profile-charmander",
      target: "claude-code", mode: "copy"
    });

    expect(result.moves_synced.sort()).toEqual(["move-pr-create", "move-tdd-cycle"]);
    expect(result.moves_skipped_unsupported).toEqual([]);

    const tddSkill = join(repoPath, ".claude", "skills", "charmander", "move-tdd-cycle", "SKILL.md");
    expect(existsSync(tddSkill)).toBe(true);
    expect(readFileSync(tddSkill, "utf8")).toContain("# TDD");
  });

  it("skips moves whose applies_to excludes the target", () => {
    const result: SyncResult = syncMoveset({
      vaultPath, repoPath, pokemon_id: "profile-charmander",
      target: "openclaw", mode: "copy"
    });
    expect(result.moves_synced).toEqual(["move-tdd-cycle"]);
    expect(result.moves_skipped_unsupported).toEqual(["move-pr-create"]);
  });

  it("writes a _pokemon.json manifest", () => {
    syncMoveset({
      vaultPath, repoPath, pokemon_id: "profile-charmander",
      target: "claude-code", mode: "copy"
    });
    const manifestPath = join(repoPath, ".claude", "skills", "charmander", "_pokemon.json");
    expect(existsSync(manifestPath)).toBe(true);
    const m = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(m.pokemon_id).toBe("profile-charmander");
    expect(m.target).toBe("claude-code");
    expect(m.moves.sort()).toEqual(["move-pr-create", "move-tdd-cycle"]);
  });

  it("writes a deployment registry entry to _index/deployments.json (Plan C.1c)", () => {
    syncMoveset({
      vaultPath,
      repoPath,
      pokemon_id: "profile-charmander",
      target: "claude-code",
      mode: "copy"
    });
    const regPath = join(vaultPath, "_index", "deployments.json");
    expect(existsSync(regPath)).toBe(true);
    const reg = JSON.parse(readFileSync(regPath, "utf8"));
    expect(reg["profile-charmander"]).toBeDefined();
    expect(reg["profile-charmander"][0].repo_path).toBe(repoPath);
    expect(reg["profile-charmander"][0].target).toBe("claude-code");
    expect(reg["profile-charmander"][0].mode).toBe("copy");
  });
});
