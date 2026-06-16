// vault-mcp/tests/unit/sync-skills-claim-render.test.ts
//
// task-sync-skills-claim-rendering (Claims Plan 3, Wave 2). Verifies that
// `vault_sync surface=skills` renders the §8.2 claim section into each move's vault
// SKILL.md *before* `syncMoveset` deploys, so the deployed copy carries the
// freshly-rendered `## Learned` block. Reverify path is unchanged — no
// claim rendering on reverify.
//
// Hermetic: every fixture under os.tmpdir() via the existing test helpers
// (mkTempVault + writeClaimFile). `today` is injected through ctx so the
// render-date is deterministic.
//
// Test surface:
//   1. After sync surface=skills, the vault's wikis/_agents/moves/<id>/SKILL.md
//      contains the vault-claims:start..end block with a single bullet for
//      the seeded active claim.
//   2. The pre-render loop iterates every move in the deploying profile's
//      moveset (verified by seeding two moves + claims for both).
//   3. A move whose vault SKILL.md does NOT exist is silently skipped.
//   4. `today` defaults to `new Date()` when ctx.today is omitted (smoke).
//   5. `claimsConfig` defaults to `getClaimsConfig({})` when ctx.rawConfig
//      is omitted (smoke — render still happens with default thresholds).
//   6. `reverify: true` does NOT mutate vault SKILL.md (no rendering).
//   7. Idempotency: running sync twice with the same `today` produces
//      a byte-identical vault SKILL.md.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { syncTool } from "../../src/tools/sync.js";
import { writeClaimFile } from "../helpers.js";

const TODAY = new Date("2026-05-03T00:00:00Z");

function seedProfile(vaultPath: string, profileId: string, moveset: string[]): void {
  const profilesDir = join(vaultPath, "wikis", "_agents", "profiles");
  mkdirSync(profilesDir, { recursive: true });
  const moveYaml = `[${moveset.join(", ")}]`;
  writeFileSync(
    join(profilesDir, `${profileId}.md`),
    `---
id: ${profileId}
type: profile
title: ${profileId}
created: 2026-04-29
wiki: _agents
status: active
summary: x
pokemon_type: fire
evolution_stage: basic
moveset: ${moveYaml}
applies_to: [claude-code]
---

# ${profileId}
`
  );
}

function seedMoveSkillMd(vaultPath: string, moveId: string): void {
  const moveDir = join(vaultPath, "wikis", "_agents", "moves", moveId);
  mkdirSync(moveDir, { recursive: true });
  writeFileSync(
    join(moveDir, "SKILL.md"),
    `---
id: ${moveId}
type: move
title: ${moveId}
created: 2026-04-29
name: ${moveId}
description: x
applies_to: [claude-code]
---

# ${moveId}
`
  );
}

function mkTempVaultWithAgentsTree(): string {
  const dir = mkdtempSync(join(tmpdir(), "vault-ssc-"));
  mkdirSync(join(dir, "wikis", "_agents", "claim"), { recursive: true });
  mkdirSync(join(dir, "_index"), { recursive: true });
  return dir;
}

describe("vault_sync surface=skills — claim rendering pre-pass", () => {
  let vaultPath: string;
  let repoPath: string;

  beforeEach(() => {
    vaultPath = mkTempVaultWithAgentsTree();
    repoPath = mkdtempSync(join(tmpdir(), "repo-ssc-"));
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    rmSync(repoPath, { recursive: true, force: true });
  });

  it("renders the vault-claims block into the vault's SKILL.md before deployment", async () => {
    seedProfile(vaultPath, "profile-charmander", ["move-tdd-cycle"]);
    seedMoveSkillMd(vaultPath, "move-tdd-cycle");
    await writeClaimFile(vaultPath, {
      id: "claim-tdd-1",
      key: "k.alpha",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      profile: ["profile-charmander"],
      move: ["move-tdd-cycle"],
      evidence: ["ev-1"],
    });

    await syncTool.handler(
      {
        surface: "skills",
        repo_path: repoPath,
        pokemon: "profile-charmander",
        runtime: "claude-code",
        mode: "copy",
        reverify: false,
        fix: false,
      },
      { vaultPath, today: TODAY } as any
    );

    const vaultSkill = readFileSync(
      join(vaultPath, "wikis", "_agents", "moves", "move-tdd-cycle", "SKILL.md"),
      "utf8"
    );
    expect(vaultSkill).toContain("<!-- vault-claims:start");
    expect(vaultSkill).toContain("<!-- vault-claims:end -->");
    expect(vaultSkill).toContain("## Learned");
    expect(vaultSkill).toContain("**`k.alpha`**");
    expect(vaultSkill).toContain("[[ev-1]]");

    // The deployed copy carries the freshly-rendered block.
    const deployed = readFileSync(
      join(repoPath, ".claude", "skills", "charmander", "move-tdd-cycle", "SKILL.md"),
      "utf8"
    );
    expect(deployed).toContain("<!-- vault-claims:start");
    expect(deployed).toContain("**`k.alpha`**");
  });

  it("iterates every move in the deploying profile's moveset", async () => {
    seedProfile(vaultPath, "profile-charmander", ["move-tdd-cycle", "move-create-pr"]);
    seedMoveSkillMd(vaultPath, "move-tdd-cycle");
    seedMoveSkillMd(vaultPath, "move-create-pr");
    await writeClaimFile(vaultPath, {
      id: "claim-tdd-1",
      key: "k.tdd",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      move: ["move-tdd-cycle"],
    });
    await writeClaimFile(vaultPath, {
      id: "claim-pr-1",
      key: "k.pr",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      move: ["move-create-pr"],
    });

    await syncTool.handler(
      {
        surface: "skills",
        repo_path: repoPath,
        pokemon: "profile-charmander",
        runtime: "claude-code",
        mode: "copy",
        reverify: false,
        fix: false,
      },
      { vaultPath, today: TODAY } as any
    );

    const tdd = readFileSync(
      join(vaultPath, "wikis", "_agents", "moves", "move-tdd-cycle", "SKILL.md"),
      "utf8"
    );
    const pr = readFileSync(
      join(vaultPath, "wikis", "_agents", "moves", "move-create-pr", "SKILL.md"),
      "utf8"
    );
    expect(tdd).toContain("**`k.tdd`**");
    expect(pr).toContain("**`k.pr`**");
  });

  it("silently skips a move whose vault SKILL.md does not exist", async () => {
    seedProfile(vaultPath, "profile-charmander", ["move-tdd-cycle", "move-missing"]);
    seedMoveSkillMd(vaultPath, "move-tdd-cycle");
    // move-missing intentionally has no SKILL.md.
    await writeClaimFile(vaultPath, {
      id: "claim-tdd-1",
      key: "k.tdd",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      move: ["move-tdd-cycle"],
    });

    // Should not throw despite the missing SKILL.md.
    await expect(
      syncTool.handler(
        {
          surface: "skills",
          repo_path: repoPath,
          pokemon: "profile-charmander",
          runtime: "claude-code",
          mode: "copy",
          reverify: false,
          fix: false,
        },
        { vaultPath, today: TODAY } as any
      )
    ).resolves.toBeDefined();

    // The existing move was rendered.
    const tdd = readFileSync(
      join(vaultPath, "wikis", "_agents", "moves", "move-tdd-cycle", "SKILL.md"),
      "utf8"
    );
    expect(tdd).toContain("**`k.tdd`**");
  });

  it("defaults today to new Date() when ctx.today is omitted", async () => {
    seedProfile(vaultPath, "profile-charmander", ["move-tdd-cycle"]);
    seedMoveSkillMd(vaultPath, "move-tdd-cycle");
    await writeClaimFile(vaultPath, {
      id: "claim-tdd-1",
      key: "k.alpha",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      move: ["move-tdd-cycle"],
    });

    // No `today` in ctx — handler should default to new Date() and still render.
    await syncTool.handler(
      {
        surface: "skills",
        repo_path: repoPath,
        pokemon: "profile-charmander",
        runtime: "claude-code",
        mode: "copy",
        reverify: false,
        fix: false,
      },
      { vaultPath } as any
    );

    const vaultSkill = readFileSync(
      join(vaultPath, "wikis", "_agents", "moves", "move-tdd-cycle", "SKILL.md"),
      "utf8"
    );
    expect(vaultSkill).toContain("<!-- vault-claims:start");
    expect(vaultSkill).toContain("**`k.alpha`**");
  });

  it("defaults claimsConfig to getClaimsConfig({}) when ctx.rawConfig is omitted", async () => {
    seedProfile(vaultPath, "profile-charmander", ["move-tdd-cycle"]);
    seedMoveSkillMd(vaultPath, "move-tdd-cycle");
    // confidence 0.9 is well above default render_min_confidence (0.4), so
    // a default-config render must include it.
    await writeClaimFile(vaultPath, {
      id: "claim-tdd-1",
      key: "k.default",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      move: ["move-tdd-cycle"],
    });

    await syncTool.handler(
      {
        surface: "skills",
        repo_path: repoPath,
        pokemon: "profile-charmander",
        runtime: "claude-code",
        mode: "copy",
        reverify: false,
        fix: false,
      },
      { vaultPath, today: TODAY } as any // intentionally no rawConfig
    );

    const vaultSkill = readFileSync(
      join(vaultPath, "wikis", "_agents", "moves", "move-tdd-cycle", "SKILL.md"),
      "utf8"
    );
    expect(vaultSkill).toContain("**`k.default`**");
  });

  it("does NOT render claim sections on the reverify path", async () => {
    seedProfile(vaultPath, "profile-charmander", ["move-tdd-cycle"]);
    seedMoveSkillMd(vaultPath, "move-tdd-cycle");
    await writeClaimFile(vaultPath, {
      id: "claim-tdd-1",
      key: "k.alpha",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      move: ["move-tdd-cycle"],
    });

    const skillPath = join(vaultPath, "wikis", "_agents", "moves", "move-tdd-cycle", "SKILL.md");
    const before = readFileSync(skillPath, "utf8");

    await syncTool.handler(
      {
        surface: "skills",
        repo_path: repoPath,
        pokemon: "profile-charmander",
        runtime: "claude-code",
        mode: "copy",
        reverify: true,
        fix: false,
      },
      { vaultPath, today: TODAY } as any
    );

    const after = readFileSync(skillPath, "utf8");
    // Reverify path must not mutate vault SKILL.md.
    expect(after).toBe(before);
    expect(after).not.toContain("vault-claims:start");
  });

  it("is idempotent: running sync twice with the same today yields byte-identical SKILL.md", async () => {
    seedProfile(vaultPath, "profile-charmander", ["move-tdd-cycle"]);
    seedMoveSkillMd(vaultPath, "move-tdd-cycle");
    await writeClaimFile(vaultPath, {
      id: "claim-tdd-1",
      key: "k.alpha",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      move: ["move-tdd-cycle"],
      evidence: ["ev-1"],
    });

    const args = {
      surface: "skills" as const,
      repo_path: repoPath,
      pokemon: "profile-charmander",
      runtime: "claude-code" as const,
      mode: "copy" as const,
      reverify: false,
      fix: false,
    };
    const ctx = { vaultPath, today: TODAY } as any;

    await syncTool.handler(args, ctx);
    const skillPath = join(vaultPath, "wikis", "_agents", "moves", "move-tdd-cycle", "SKILL.md");
    const first = readFileSync(skillPath, "utf8");

    await syncTool.handler(args, ctx);
    const second = readFileSync(skillPath, "utf8");

    expect(second).toBe(first);
  });
});
