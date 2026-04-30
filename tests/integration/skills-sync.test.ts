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

describe("integration — sync-skills --reverify + --fix (T3-2)", () => {
  let vaultPath: string;
  let repoPath: string;

  beforeEach(async () => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-int-ssr-"));
    repoPath = mkdtempSync(join(tmpdir(), "repo-int-ssr-"));

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

    // Seed: a real deployment so reverify has something to scan.
    await syncSkillsTool.handler(
      { repo_path: repoPath, pokemon: "profile-charmander", target: "claude-code", mode: "copy" },
      { vaultPath }
    );
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    rmSync(repoPath, { recursive: true, force: true });
  });

  it("reverify against a clean deployment returns empty drift", async () => {
    const r = await syncSkillsTool.handler(
      {
        repo_path: repoPath,
        pokemon: "profile-charmander",
        target: "claude-code",
        mode: "copy",
        reverify: true
      },
      { vaultPath }
    );
    expect(r.drift).toEqual([]);
    expect(r.drift_fixed).toBe(0);
  });

  it("reverify reports kind: hash-mismatch when a deployed SKILL.md is tampered", async () => {
    const tamperedPath = join(repoPath, ".claude", "skills", "charmander", "move-cc-only", "SKILL.md");
    writeFileSync(tamperedPath, "tampered\n");

    const r = await syncSkillsTool.handler(
      {
        repo_path: repoPath,
        pokemon: "profile-charmander",
        target: "claude-code",
        mode: "copy",
        reverify: true
      },
      { vaultPath }
    );
    expect(r.drift.length).toBe(1);
    expect(r.drift[0].kind).toBe("hash-mismatch");
    expect(r.drift[0].move_id).toBe("move-cc-only");
    expect(r.drift[0].deployment_path).toBe(tamperedPath);
    expect(r.drift[0].expected_hash).toBeTruthy();
    expect(r.drift[0].actual_hash).toBeTruthy();
    expect(r.drift[0].actual_hash).not.toBe(r.drift[0].expected_hash);
    expect(r.drift_fixed).toBe(0);
  });

  it("reverify reports kind: missing when a deployed move directory is removed", async () => {
    const movedir = join(repoPath, ".claude", "skills", "charmander", "move-multi");
    rmSync(movedir, { recursive: true, force: true });

    const r = await syncSkillsTool.handler(
      {
        repo_path: repoPath,
        pokemon: "profile-charmander",
        target: "claude-code",
        mode: "copy",
        reverify: true
      },
      { vaultPath }
    );
    expect(r.drift.length).toBe(1);
    expect(r.drift[0].kind).toBe("missing");
    expect(r.drift[0].move_id).toBe("move-multi");
    expect(r.drift[0].actual_hash).toBeUndefined();
    expect(r.drift_fixed).toBe(0);
  });

  it("fix=false leaves drift_fixed at 0 even when drift entries exist", async () => {
    const tamperedPath = join(repoPath, ".claude", "skills", "charmander", "move-cc-only", "SKILL.md");
    writeFileSync(tamperedPath, "tampered\n");

    const r = await syncSkillsTool.handler(
      {
        repo_path: repoPath,
        pokemon: "profile-charmander",
        target: "claude-code",
        mode: "copy",
        reverify: true,
        fix: false
      },
      { vaultPath }
    );
    expect(r.drift.length).toBe(1);
    expect(r.drift_fixed).toBe(0);
    // Tampered file untouched.
    expect(readFileSync(tamperedPath, "utf8")).toBe("tampered\n");
  });

  it("fix=true after detection re-deploys drifted moves; subsequent reverify is clean", async () => {
    const tamperedPath = join(repoPath, ".claude", "skills", "charmander", "move-cc-only", "SKILL.md");
    writeFileSync(tamperedPath, "tampered\n");

    const r1 = await syncSkillsTool.handler(
      {
        repo_path: repoPath,
        pokemon: "profile-charmander",
        target: "claude-code",
        mode: "copy",
        reverify: true,
        fix: true
      },
      { vaultPath }
    );
    expect(r1.drift.length).toBe(1);
    expect(r1.drift_fixed).toBeGreaterThanOrEqual(1);

    // Subsequent reverify: clean.
    const r2 = await syncSkillsTool.handler(
      {
        repo_path: repoPath,
        pokemon: "profile-charmander",
        target: "claude-code",
        mode: "copy",
        reverify: true
      },
      { vaultPath }
    );
    expect(r2.drift).toEqual([]);
    expect(r2.drift_fixed).toBe(0);
  });

  it("fix=true repairs missing move directories", async () => {
    const movedir = join(repoPath, ".claude", "skills", "charmander", "move-multi");
    rmSync(movedir, { recursive: true, force: true });

    const r = await syncSkillsTool.handler(
      {
        repo_path: repoPath,
        pokemon: "profile-charmander",
        target: "claude-code",
        mode: "copy",
        reverify: true,
        fix: true
      },
      { vaultPath }
    );
    expect(r.drift.length).toBe(1);
    expect(r.drift_fixed).toBe(1);
    expect(existsSync(join(movedir, "SKILL.md"))).toBe(true);
  });

  it("fix=true without reverify=true throws a validation error", async () => {
    await expect(
      syncSkillsTool.handler(
        {
          repo_path: repoPath,
          pokemon: "profile-charmander",
          target: "claude-code",
          mode: "copy",
          reverify: false,
          fix: true
        },
        { vaultPath }
      )
    ).rejects.toThrow(/fix.*reverify/i);
  });

  it("reverify=false (default) preserves existing deploy behavior", async () => {
    // Wipe deployed skills then call without reverify; should re-deploy as before.
    rmSync(join(repoPath, ".claude"), { recursive: true, force: true });

    const r = await syncSkillsTool.handler(
      { repo_path: repoPath, pokemon: "profile-charmander", target: "claude-code", mode: "copy" },
      { vaultPath }
    );
    expect(r.moves_synced.sort()).toEqual(["move-cc-only", "move-multi"]);
    expect(r.moves_skipped_unsupported).toEqual([]);
    expect(r.drift).toBeUndefined();
    expect(r.drift_fixed).toBeUndefined();
  });
});
