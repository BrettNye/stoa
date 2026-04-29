import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { syncSkillsTool } from "../../src/tools/sync-skills.js";

describe("integration — sync-skills with multi-target filtering", () => {
  let vaultPath: string;
  let repoPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-int-ss-"));
    repoPath = mkdtempSync(join(tmpdir(), "repo-int-ss-"));

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
moveset: [move-cc-only, move-multi]
applies_to: [claude-code]
---

# Charmander
`);

    const m1 = join(vaultPath, "wikis", "_agents", "moves", "move-cc-only");
    mkdirSync(m1, { recursive: true });
    writeFileSync(join(m1, "SKILL.md"),
      `---
id: move-cc-only
type: move
title: CC only
created: 2026-04-29
name: cc-only
description: x
applies_to: [claude-code]
---

# CC only
`);

    const m2 = join(vaultPath, "wikis", "_agents", "moves", "move-multi");
    mkdirSync(m2, { recursive: true });
    writeFileSync(join(m2, "SKILL.md"),
      `---
id: move-multi
type: move
title: Multi
created: 2026-04-29
name: multi
description: x
applies_to: [claude-code, openclaw, codex]
---

# Multi
`);
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    rmSync(repoPath, { recursive: true, force: true });
  });

  it("syncing to claude-code includes both moves", async () => {
    const r = await syncSkillsTool.handler(
      { repo_path: repoPath, pokemon: "profile-charmander", target: "claude-code", mode: "copy" },
      { vaultPath }
    );
    expect(r.moves_synced.sort()).toEqual(["move-cc-only", "move-multi"]);
    expect(r.moves_skipped_unsupported).toEqual([]);
  });

  it("syncing to openclaw skips claude-code-only moves", async () => {
    const r = await syncSkillsTool.handler(
      { repo_path: repoPath, pokemon: "profile-charmander", target: "openclaw", mode: "copy" },
      { vaultPath }
    );
    expect(r.moves_synced).toEqual(["move-multi"]);
    expect(r.moves_skipped_unsupported).toEqual(["move-cc-only"]);
  });

  it("manifest reflects the synced state", async () => {
    await syncSkillsTool.handler(
      { repo_path: repoPath, pokemon: "profile-charmander", target: "claude-code", mode: "copy" },
      { vaultPath }
    );
    const m = JSON.parse(readFileSync(
      join(repoPath, ".claude", "skills", "charmander", "_pokemon.json"),
      "utf8"
    ));
    expect(m.moves.sort()).toEqual(["move-cc-only", "move-multi"]);
    expect(m.target).toBe("claude-code");
  });
});
