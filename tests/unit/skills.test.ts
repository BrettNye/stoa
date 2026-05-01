import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, platform } from "node:os";
import {
  resolveSkillsDir, syncMoveset, removeOldDeployment, SyncResult
} from "../../src/core/skills.js";
import * as skillsPlatform from "../../src/core/skills-platform.js";
import type { DeploymentEntry } from "../../src/core/deployments.js";

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

  // T2-2 (v1.6 Phase 1): actual_mode is recorded alongside requested mode.
  // Spec ref: §3.1, §5.4.

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requested=symlink succeeds → entry has actual_mode='symlink' AND mode='symlink' (Case A)", () => {
    // Force deployMove to report symlink success irrespective of host capability.
    vi.spyOn(skillsPlatform, "deployMove").mockReturnValue({ actual_mode: "symlink" });

    syncMoveset({
      vaultPath, repoPath, pokemon_id: "profile-charmander",
      target: "claude-code", mode: "symlink"
    });

    const reg = JSON.parse(readFileSync(join(vaultPath, "_index", "deployments.json"), "utf8"));
    const entry = reg["profile-charmander"][0];
    expect(entry.mode).toBe("symlink");
    expect(entry.actual_mode).toBe("symlink");
  });

  it("requested=symlink falls back to copy → entry has actual_mode='copy' AND mode='symlink' (Case B)", () => {
    vi.spyOn(skillsPlatform, "deployMove").mockReturnValue({ actual_mode: "copy" });

    syncMoveset({
      vaultPath, repoPath, pokemon_id: "profile-charmander",
      target: "claude-code", mode: "symlink"
    });

    const reg = JSON.parse(readFileSync(join(vaultPath, "_index", "deployments.json"), "utf8"));
    const entry = reg["profile-charmander"][0];
    expect(entry.mode).toBe("symlink");          // request preserved
    expect(entry.actual_mode).toBe("copy");      // truth on disk
  });

  it("requested=copy → entry has both mode and actual_mode = 'copy' (Case C)", () => {
    syncMoveset({
      vaultPath, repoPath, pokemon_id: "profile-charmander",
      target: "claude-code", mode: "copy"
    });

    const reg = JSON.parse(readFileSync(join(vaultPath, "_index", "deployments.json"), "utf8"));
    const entry = reg["profile-charmander"][0];
    expect(entry.mode).toBe("copy");
    expect(entry.actual_mode).toBe("copy");
  });
});

describe("removeOldDeployment", () => {
  let vaultPath: string;
  let repoPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-rm-"));
    repoPath = mkdtempSync(join(tmpdir(), "repo-rm-"));
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    rmSync(repoPath, { recursive: true, force: true });
  });

  it("removes the deployed skills directory; idempotent on second call (Case D)", () => {
    // Seed a deployed skills dir at the conventional path.
    const skillsDir = join(repoPath, ".claude", "skills", "charmander");
    mkdirSync(join(skillsDir, "move-tdd-cycle"), { recursive: true });
    writeFileSync(join(skillsDir, "move-tdd-cycle", "SKILL.md"), "# tdd\n");
    expect(existsSync(skillsDir)).toBe(true);

    const entry: DeploymentEntry = {
      repo_path: repoPath,
      target: "claude-code",
      mode: "copy",
      actual_mode: "copy",
      synced_at: "2026-04-29T00:00:00Z"
    };

    removeOldDeployment(entry, "profile-charmander");
    expect(existsSync(skillsDir)).toBe(false);

    // Second call must not throw (idempotent no-op).
    expect(() => removeOldDeployment(entry, "profile-charmander")).not.toThrow();
    expect(existsSync(skillsDir)).toBe(false);
  });

  it("doesn't throw on a missing skills dir (Case E)", () => {
    const entry: DeploymentEntry = {
      repo_path: repoPath,
      target: "claude-code",
      mode: "copy",
      actual_mode: "copy",
      synced_at: "2026-04-29T00:00:00Z"
    };
    // No skills dir was ever created.
    const skillsDir = join(repoPath, ".claude", "skills", "charmander");
    expect(existsSync(skillsDir)).toBe(false);

    expect(() => removeOldDeployment(entry, "profile-charmander")).not.toThrow();
  });
});
