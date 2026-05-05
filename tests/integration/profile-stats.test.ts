import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { profileStatsTool } from "../../src/tools/profile-stats.js";
import { reindex } from "../../src/core/reindex.js";

describe("vault.profile-stats", () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-pstats-"));
    const profilesDir = join(vaultPath, "wikis", "_agents", "profiles");
    mkdirSync(profilesDir, { recursive: true });
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    writeFileSync(join(profilesDir, "profile-charmander.md"),
      `---
id: profile-charmander
title: Charmander
type: profile
wiki: _agents
status: active
created: 2026-01-01
updated: 2026-04-30
summary: Backend specialist
pokemon_type: fire
evolution_stage: basic
autonomy_level: restricted
moveset: [move-tdd-cycle]
applies_to: [claude-code]
---

# Charmander
`);
    await reindex(vaultPath);
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("returns the profile row from _index/profiles.json with computed days_since_creation", async () => {
    const r = await profileStatsTool.handler({ pokemon_id: "profile-charmander", wiki: "_agents" }, { vaultPath });
    expect(r.profile_id).toBe("profile-charmander");
    expect(r.pokemon_type).toBe("fire");
    expect(r.evolution_stage).toBe("basic");
    expect(r.tasks_completed).toBe(0);  // no tasks in fixture
    expect(r.success_rate).toBe(0);
    expect(r.days_since_creation).toBeGreaterThan(0);  // 2026-01-01 is in the past
  });

  it("includes next_evolution_threshold for basic stage", async () => {
    const r = await profileStatsTool.handler({ pokemon_id: "profile-charmander", wiki: "_agents" }, { vaultPath });
    expect(r.next_evolution_threshold).toBeDefined();
    expect(r.next_evolution_threshold?.stage).toBe("stage1");
    expect(r.next_evolution_threshold?.criteria).toMatch(/30.*tasks.*0\.80/);
  });

  it("throws when pokemon_id does not exist in the index", async () => {
    await expect(
      profileStatsTool.handler({ pokemon_id: "profile-nonexistent", wiki: "_agents" }, { vaultPath })
    ).rejects.toThrow(/PROFILE_NOT_FOUND|not.found/i);
  });
});
