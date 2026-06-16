import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { syncTool } from "../../src/tools/sync.js";

// ---------------------------------------------------------------------------
// Shared fixture helpers
// ---------------------------------------------------------------------------

function writeProfile(vaultPath: string, id: string, moveset: string[] = [], pokemon_type = "fire") {
  const profilesDir = join(vaultPath, "wikis", "_agents", "profiles");
  mkdirSync(profilesDir, { recursive: true });
  writeFileSync(join(profilesDir, `${id}.md`),
    `---
id: ${id}
type: profile
title: ${id}
created: 2026-04-29
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

function writeMove(vaultPath: string, id: string, applies_to = ["claude-code", "openclaw", "codex"]) {
  const moveDir = join(vaultPath, "wikis", "_agents", "moves", id);
  mkdirSync(moveDir, { recursive: true });
  writeFileSync(join(moveDir, "SKILL.md"),
    `---
id: ${id}
type: move
title: ${id}
created: 2026-04-29
name: ${id}
description: x
applies_to: [${applies_to.join(", ")}]
---

# ${id}
`);
}

// ---------------------------------------------------------------------------
// surface=skills — deploy path
// ---------------------------------------------------------------------------

describe("vault_sync surface=skills — deploy path", () => {
  let vaultPath: string;
  let repoPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-sync-skills-"));
    repoPath = mkdtempSync(join(tmpdir(), "repo-sync-skills-"));
    writeProfile(vaultPath, "profile-charmander", ["move-cc-only", "move-multi"]);
    writeMove(vaultPath, "move-cc-only", ["claude-code"]);
    writeMove(vaultPath, "move-multi", ["claude-code", "openclaw", "codex"]);
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    rmSync(repoPath, { recursive: true, force: true });
  });

  it("syncs a Pokemon's moveset to claude-code skills dir", async () => {
    const result = await syncTool.handler(
      { surface: "skills", repo_path: repoPath, pokemon: "profile-charmander", runtime: "claude-code" },
      { vaultPath }
    );
    expect(result.moves_synced.sort()).toEqual(["move-cc-only", "move-multi"]);
    expect(existsSync(join(repoPath, ".claude", "skills", "charmander", "move-cc-only", "SKILL.md"))).toBe(true);
  });

  it("syncing to openclaw skips claude-code-only moves", async () => {
    const result = await syncTool.handler(
      { surface: "skills", repo_path: repoPath, pokemon: "profile-charmander", runtime: "openclaw" },
      { vaultPath }
    );
    expect(result.moves_synced).toEqual(["move-multi"]);
    expect(result.moves_skipped_unsupported).toEqual(["move-cc-only"]);
  });

  it("syncing to codex uses the codex runtime", async () => {
    const result = await syncTool.handler(
      { surface: "skills", repo_path: repoPath, pokemon: "profile-charmander", runtime: "codex" },
      { vaultPath }
    );
    expect(result.moves_synced).toEqual(["move-multi"]);
    expect(result.moves_skipped_unsupported).toEqual(["move-cc-only"]);
  });

  it("mode defaults to symlink for skills surface when omitted", async () => {
    // Just checks it does not throw; the internal mode is symlink.
    const result = await syncTool.handler(
      { surface: "skills", repo_path: repoPath, pokemon: "profile-charmander", runtime: "claude-code" },
      { vaultPath }
    );
    expect(result.moves_synced).toBeDefined();
  });

  it("mode: copy works explicitly", async () => {
    const result = await syncTool.handler(
      { surface: "skills", repo_path: repoPath, pokemon: "profile-charmander", mode: "copy", runtime: "claude-code" },
      { vaultPath }
    );
    expect(result.moves_synced.sort()).toEqual(["move-cc-only", "move-multi"]);
  });

  it("manifest reflects the synced state", async () => {
    await syncTool.handler(
      { surface: "skills", repo_path: repoPath, pokemon: "profile-charmander", mode: "copy", runtime: "claude-code" },
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

// ---------------------------------------------------------------------------
// surface=skills — refines enforced in handler
// ---------------------------------------------------------------------------

describe("vault_sync surface=skills — refines (H2)", () => {
  let vaultPath: string;
  let repoPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-sync-sr-"));
    repoPath = mkdtempSync(join(tmpdir(), "repo-sync-sr-"));
    writeProfile(vaultPath, "profile-charmander", ["move-cc-only"]);
    writeMove(vaultPath, "move-cc-only", ["claude-code"]);
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    rmSync(repoPath, { recursive: true, force: true });
  });

  it("rejects pokemon AND all together", async () => {
    await expect(syncTool.handler(
      { surface: "skills", repo_path: repoPath, pokemon: "profile-charmander", all: true, runtime: "claude-code" },
      { vaultPath }
    )).rejects.toThrow(/mutually exclusive/);
  });

  it("rejects deploy (reverify=false) with neither pokemon nor all", async () => {
    await expect(syncTool.handler(
      { surface: "skills", repo_path: repoPath, runtime: "claude-code" },
      { vaultPath }
    )).rejects.toThrow(/pokemon.*all/i);
  });

  it("accepts reverify: true without pokemon (implicit all path)", async () => {
    // Should not throw even with no pokemon
    const r = await syncTool.handler(
      { surface: "skills", repo_path: repoPath, reverify: true, runtime: "claude-code" },
      { vaultPath }
    );
    expect(r.drift).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// surface=skills — reverify + fix
// ---------------------------------------------------------------------------

describe("vault_sync surface=skills — reverify + fix", () => {
  let vaultPath: string;
  let repoPath: string;

  beforeEach(async () => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-sync-rv-"));
    repoPath = mkdtempSync(join(tmpdir(), "repo-sync-rv-"));
    writeProfile(vaultPath, "profile-charmander", ["move-cc-only", "move-multi"]);
    writeMove(vaultPath, "move-cc-only", ["claude-code"]);
    writeMove(vaultPath, "move-multi", ["claude-code", "openclaw", "codex"]);
    // Seed a deployment so reverify has something to scan.
    await syncTool.handler(
      { surface: "skills", repo_path: repoPath, pokemon: "profile-charmander", mode: "copy", runtime: "claude-code" },
      { vaultPath }
    );
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    rmSync(repoPath, { recursive: true, force: true });
  });

  it("reverify against a clean deployment returns empty drift", async () => {
    const r = await syncTool.handler(
      { surface: "skills", repo_path: repoPath, pokemon: "profile-charmander", mode: "copy", reverify: true, runtime: "claude-code" },
      { vaultPath }
    );
    expect(r.drift).toEqual([]);
    expect(r.drift_fixed).toBe(0);
  });

  it("reverify reports hash-mismatch when a deployed SKILL.md is tampered", async () => {
    const tamperedPath = join(repoPath, ".claude", "skills", "charmander", "move-cc-only", "SKILL.md");
    writeFileSync(tamperedPath, "tampered\n");

    const r = await syncTool.handler(
      { surface: "skills", repo_path: repoPath, pokemon: "profile-charmander", mode: "copy", reverify: true, runtime: "claude-code" },
      { vaultPath }
    );
    expect(r.drift.length).toBe(1);
    expect(r.drift[0].kind).toBe("hash-mismatch");
    expect(r.drift[0].move_id).toBe("move-cc-only");
    expect(r.drift_fixed).toBe(0);
  });

  it("reverify reports missing when a deployed move directory is removed", async () => {
    const movedir = join(repoPath, ".claude", "skills", "charmander", "move-multi");
    rmSync(movedir, { recursive: true, force: true });

    const r = await syncTool.handler(
      { surface: "skills", repo_path: repoPath, pokemon: "profile-charmander", mode: "copy", reverify: true, runtime: "claude-code" },
      { vaultPath }
    );
    expect(r.drift.length).toBe(1);
    expect(r.drift[0].kind).toBe("missing");
    expect(r.drift[0].move_id).toBe("move-multi");
  });

  it("fix=true re-deploys drifted moves", async () => {
    const tamperedPath = join(repoPath, ".claude", "skills", "charmander", "move-cc-only", "SKILL.md");
    writeFileSync(tamperedPath, "tampered\n");

    const r = await syncTool.handler(
      { surface: "skills", repo_path: repoPath, pokemon: "profile-charmander", mode: "copy", reverify: true, fix: true, runtime: "claude-code" },
      { vaultPath }
    );
    expect(r.drift.length).toBe(1);
    expect(r.drift_fixed).toBeGreaterThanOrEqual(1);
  });

  it("fix=true without reverify=true throws", async () => {
    await expect(syncTool.handler(
      { surface: "skills", repo_path: repoPath, pokemon: "profile-charmander", mode: "copy", reverify: false, fix: true, runtime: "claude-code" },
      { vaultPath }
    )).rejects.toThrow(/fix.*reverify/i);
  });
});

// ---------------------------------------------------------------------------
// surface=skills — all: true (multi-profile)
// ---------------------------------------------------------------------------

describe("vault_sync surface=skills — all: true", () => {
  let vaultPath: string;
  let repoPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-sync-sa-"));
    repoPath = mkdtempSync(join(tmpdir(), "repo-sync-sa-"));
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    writeFileSync(join(vaultPath, "_index", "deployments.json"), "{}");
    writeMove(vaultPath, "move-tdd-cycle", ["claude-code"]);
    writeProfile(vaultPath, "profile-squirtle", ["move-tdd-cycle"], "water");
    writeProfile(vaultPath, "profile-charmander", ["move-tdd-cycle"], "fire");
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    rmSync(repoPath, { recursive: true, force: true });
  });

  it("deploys movesets for every profile when all: true", async () => {
    const result: any = await syncTool.handler(
      { surface: "skills", repo_path: repoPath, all: true, runtime: "claude-code", mode: "copy" },
      { vaultPath }
    );
    expect(result.summary.deployed).toBe(2);
    expect(result.results).toHaveLength(2);
  });

  it("preserves single-pokemon flat output shape (back-compat)", async () => {
    const result: any = await syncTool.handler(
      { surface: "skills", repo_path: repoPath, pokemon: "profile-squirtle", runtime: "claude-code", mode: "copy" },
      { vaultPath }
    );
    expect(result.skills_dir).toBeDefined();
    expect(result.moves_synced).toBeDefined();
    expect(result.results).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// surface=agents — C1 / H1 checks
// ---------------------------------------------------------------------------

describe("vault_sync surface=agents — C1 and H1", () => {
  it("rejects non-claude-code runtime with named error (C1)", async () => {
    await expect(syncTool.handler(
      { surface: "agents", repo_path: "/tmp/x", pokemon: "any", runtime: "openclaw" as any },
      { vaultPath: "/tmp/x" }
    )).rejects.toThrow(/surface=agents supports runtime 'claude-code' only/);
  });

  it("mode defaults to copy for agents surface when omitted (H1)", () => {
    // We just verify the schema accepts missing mode (no error thrown at parse time).
    const Input = syncTool.inputSchema;
    const r = Input.safeParse({ surface: "agents", repo_path: "/tmp/x", pokemon: "a" });
    // mode is optional in schema — parse should succeed (handler applies default)
    expect(r.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// surface=agents — refines enforced in handler (H2)
// ---------------------------------------------------------------------------

describe("vault_sync surface=agents — refines (H2)", () => {
  it("rejects pokemon AND all together", async () => {
    await expect(syncTool.handler(
      { surface: "agents", repo_path: "/tmp/x", pokemon: "charmander", all: true, runtime: "claude-code" },
      { vaultPath: "/tmp/x" }
    )).rejects.toThrow(/mutually exclusive/);
  });

  it("rejects neither pokemon nor all", async () => {
    await expect(syncTool.handler(
      { surface: "agents", repo_path: "/tmp/x", runtime: "claude-code" },
      { vaultPath: "/tmp/x" }
    )).rejects.toThrow(/one of `pokemon` or `all: true` is required/);
  });

  it("rejects exclude without all: true", async () => {
    await expect(syncTool.handler(
      { surface: "agents", repo_path: "/tmp/x", pokemon: "charmander", runtime: "claude-code", exclude: ["x"] },
      { vaultPath: "/tmp/x" }
    )).rejects.toThrow(/exclude.*pokemon_type.*only valid with `all: true`/);
  });
});

// ---------------------------------------------------------------------------
// surface=agents — schema shape
// ---------------------------------------------------------------------------

describe("vault_sync schema", () => {
  const schema = syncTool.inputSchema;

  it("accepts surface=skills with pokemon", () => {
    expect(schema.safeParse({ surface: "skills", repo_path: "/tmp/x", pokemon: "abra" }).success).toBe(true);
  });

  it("accepts surface=agents with pokemon", () => {
    expect(schema.safeParse({ surface: "agents", repo_path: "/tmp/x", pokemon: "abra" }).success).toBe(true);
  });

  it("rejects unknown surface", () => {
    expect(schema.safeParse({ surface: "unknown", repo_path: "/tmp/x", pokemon: "abra" }).success).toBe(false);
  });

  it("mode is optional at schema level (no default — H1)", () => {
    const r = schema.safeParse({ surface: "skills", repo_path: "/tmp/x", pokemon: "abra" });
    expect(r.success).toBe(true);
    if (r.success) {
      // mode should be undefined — no top-level default
      expect(r.data.mode).toBeUndefined();
    }
  });

  it("runtime defaults to claude-code", () => {
    const r = schema.safeParse({ surface: "skills", repo_path: "/tmp/x", pokemon: "abra" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.runtime).toBe("claude-code");
    }
  });
});
