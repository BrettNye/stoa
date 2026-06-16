import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lintTool } from "../../src/tools/lint.js";
import { syncTool } from "../../src/tools/sync.js";

// Wave 3 / Phase-1 T3-4d — registry-backed DEPLOYMENT_DRIFT check.
// Walks _index/deployments.json; for each entry, derives skills_dir from
// (repo_path, target, bare-name) and reads the profile's moveset, then calls
// detectDriftAt(). Each DriftReport becomes a severity:info diagnostic.
//
// Tests call through the lintTool surface (not core/lint.ts directly) because
// the registered-check registry is invoked from tools/lint.ts (Plan A T1-5).

let vaultPath: string;
let repoPath: string;

async function runLint(vp: string) {
  return lintTool.handler({ level: "warning" }, { vaultPath: vp });
}

function writeMap(wiki: string) {
  const dir = join(vaultPath, "wikis", wiki);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "map.md"), `---
id: map-${wiki}
title: ${wiki}
type: map
wiki: ${wiki}
status: active
created: 2026-04-30
updated: 2026-04-30
summary: m
---
m
`);
}

function seedFixture() {
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
moveset: [move-alpha, move-beta]
applies_to: [claude-code]
---

# Charmander
`);

  const m1 = join(vaultPath, "wikis", "_agents", "moves", "move-alpha");
  mkdirSync(m1, { recursive: true });
  writeFileSync(join(m1, "SKILL.md"),
    `---
id: move-alpha
type: move
title: Alpha
created: 2026-04-29
name: alpha
description: x
applies_to: [claude-code]
---

# Alpha
`);

  const m2 = join(vaultPath, "wikis", "_agents", "moves", "move-beta");
  mkdirSync(m2, { recursive: true });
  writeFileSync(join(m2, "SKILL.md"),
    `---
id: move-beta
type: move
title: Beta
created: 2026-04-29
name: beta
description: x
applies_to: [claude-code]
---

# Beta
`);
}

beforeEach(() => {
  vaultPath = mkdtempSync(join(tmpdir(), "vault-lint-dd-"));
  repoPath = mkdtempSync(join(tmpdir(), "repo-lint-dd-"));
  mkdirSync(join(vaultPath, "_index"), { recursive: true });
  // _agents wiki needs a map for the lint walker.
  writeMap("_agents");
});

afterEach(() => {
  rmSync(vaultPath, { recursive: true, force: true });
  rmSync(repoPath, { recursive: true, force: true });
});

describe("DEPLOYMENT_DRIFT", () => {
  it("vault with no deployments — no diagnostic", async () => {
    seedFixture();
    const r = await runLint(vaultPath);
    const drift = r.diagnostics.filter(d => d.code === "DEPLOYMENT_DRIFT");
    expect(drift).toEqual([]);
  });

  it("clean deployment — no diagnostic", async () => {
    seedFixture();
    await syncTool.handler(
      { surface: "skills", repo_path: repoPath, pokemon: "profile-charmander", runtime: "claude-code", mode: "copy" },
      { vaultPath }
    );

    const r = await runLint(vaultPath);
    const drift = r.diagnostics.filter(d => d.code === "DEPLOYMENT_DRIFT");
    expect(drift).toEqual([]);
  });

  it("tampered deployed SKILL.md — one diagnostic with kind hash-mismatch", async () => {
    seedFixture();
    await syncTool.handler(
      { surface: "skills", repo_path: repoPath, pokemon: "profile-charmander", runtime: "claude-code", mode: "copy" },
      { vaultPath }
    );

    const tamperedPath = join(repoPath, ".claude", "skills", "charmander", "move-alpha", "SKILL.md");
    writeFileSync(tamperedPath, "tampered\n");

    const r = await runLint(vaultPath);
    const drift = r.diagnostics.filter(d => d.code === "DEPLOYMENT_DRIFT");
    expect(drift.length).toBe(1);
    expect(drift[0].severity).toBe("info");
    expect(drift[0].message).toContain("hash-mismatch");
    expect(drift[0].message).toContain("move-alpha");
    expect(drift[0].message).toContain(tamperedPath);
  });

  it("deleted deployed move directory — one diagnostic with kind missing", async () => {
    seedFixture();
    await syncTool.handler(
      { surface: "skills", repo_path: repoPath, pokemon: "profile-charmander", runtime: "claude-code", mode: "copy" },
      { vaultPath }
    );

    const movedir = join(repoPath, ".claude", "skills", "charmander", "move-beta");
    rmSync(movedir, { recursive: true, force: true });

    const r = await runLint(vaultPath);
    const drift = r.diagnostics.filter(d => d.code === "DEPLOYMENT_DRIFT");
    expect(drift.length).toBe(1);
    expect(drift[0].severity).toBe("info");
    expect(drift[0].message).toContain("missing");
    expect(drift[0].message).toContain("move-beta");
  });

  it("missing profile but stale registry entry — swallowed (no crash, no diagnostic for that entry)", async () => {
    seedFixture();
    await syncTool.handler(
      { surface: "skills", repo_path: repoPath, pokemon: "profile-charmander", runtime: "claude-code", mode: "copy" },
      { vaultPath }
    );
    // Operator manually deleted the profile but registry still has entry.
    rmSync(join(vaultPath, "wikis", "_agents", "profiles", "profile-charmander.md"));

    // Should NOT crash; should NOT emit a DEPLOYMENT_DRIFT diagnostic for
    // this orphan entry (different signal — operator-side cleanup).
    const r = await runLint(vaultPath);
    const drift = r.diagnostics.filter(d => d.code === "DEPLOYMENT_DRIFT");
    expect(drift).toEqual([]);
  });
});
