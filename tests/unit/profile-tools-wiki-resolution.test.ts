// vault-mcp/tests/unit/profile-tools-wiki-resolution.test.ts
//
// task-profile-tools-update: regression tests verifying that all four profile-*
// tools resolve wiki through resolveTrainerContext instead of defaulting to
// wiki=alpha (synthesis A2 bug fix). Also verifies the ambient caller_trainer_id
// response field and the TRAINER_WIKI_UNSET error path.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ─── Shared test fixtures ─────────────────────────────────────────────────────

/**
 * Build a minimal vault WITH NO trainer configured (no active slug in toml).
 * Used to verify that NO_ACTIVE_TRAINER propagates when no explicit wiki: arg.
 */
function makeVaultNoTrainer(): { vaultPath: string; homePath: string } {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const vaultPath = join(tmpdir(), `vault-notrainer-${suffix}`);
  const homePath  = join(tmpdir(), `home-notrainer-${suffix}`);

  mkdirSync(join(vaultPath, "_index"), { recursive: true });
  writeFileSync(
    join(vaultPath, "_index", "wikis.json"),
    JSON.stringify({ wikis: [{ name: "_agents", mode: "mixed", scope: "private", description: "", page_counts: {}, last_touched: "2026-05-01" }] })
  );
  writeFileSync(join(vaultPath, "_index", "pages.json"), JSON.stringify({ pages: [] }));
  writeFileSync(join(vaultPath, "_index", "tokens.json"), JSON.stringify({}));
  writeFileSync(join(vaultPath, "_index", "links.json"), JSON.stringify({}));
  writeFileSync(
    join(vaultPath, "_index", "profiles.json"),
    JSON.stringify({
      "profile-charmander": {
        pokemon_type: "fire",
        evolution_stage: "basic",
        tasks_completed: 3,
        tasks_failed: 1,
        tasks_in_flight: 0,
        journals_count: 2,
        channels_active: 1,
        moves_used_freq: { "move-tdd-cycle": 2 }
      }
    })
  );

  mkdirSync(join(vaultPath, "wikis", "_agents", "profiles"), { recursive: true });
  mkdirSync(join(vaultPath, "wikis", "_agents", "trainers"), { recursive: true });
  mkdirSync(join(vaultPath, "wikis", "_agents", "synthesis"), { recursive: true });

  writeFileSync(
    join(vaultPath, "wikis", "_agents", "profiles", "profile-charmander.md"),
    [
      "---",
      "id: profile-charmander",
      "type: profile",
      "title: Charmander",
      "wiki: _agents",
      "status: active",
      "created: '2026-05-01'",
      "updated: '2026-05-01'",
      "pokemon: charmander",
      "evolution_stage: basic",
      "summary: Fire starter",
      "tags: [profile]",
      "---",
      "Body.",
    ].join("\n")
  );

  // stadium.toml with NO active = line so NO_ACTIVE_TRAINER will be thrown
  mkdirSync(join(homePath, ".vault"), { recursive: true });
  writeFileSync(
    join(homePath, ".vault", "stadium.toml"),
    [
      "# no active trainer configured",
      "",
      "[trainer.brett]",
      'api_key = "sk-test"',
      'base_url = "https://api.test"',
    ].join("\n")
  );

  return { vaultPath, homePath };
}

/**
 * Build a minimal vault with:
 *  - _index/{wikis,pages,tokens,links,profiles}.json
 *  - wikis/_agents/trainers/trainer-brett.md  (with wiki: _agents)
 *  - wikis/_agents/profiles/profile-charmander.md
 * Returns { vaultPath, homePath } where homePath has a stadium.toml.
 */
function makeVault(): { vaultPath: string; homePath: string } {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const vaultPath = join(tmpdir(), `vault-profile-wiki-${suffix}`);
  const homePath  = join(tmpdir(), `home-profile-wiki-${suffix}`);

  // _index dirs and files
  mkdirSync(join(vaultPath, "_index"), { recursive: true });
  writeFileSync(
    join(vaultPath, "_index", "wikis.json"),
    JSON.stringify({ wikis: [{ name: "_agents", mode: "mixed", scope: "private", description: "", page_counts: {}, last_touched: "2026-05-01" }] })
  );
  writeFileSync(join(vaultPath, "_index", "pages.json"), JSON.stringify({ pages: [] }));
  writeFileSync(join(vaultPath, "_index", "tokens.json"), JSON.stringify({}));
  writeFileSync(join(vaultPath, "_index", "links.json"), JSON.stringify({}));
  writeFileSync(
    join(vaultPath, "_index", "profiles.json"),
    JSON.stringify({
      "profile-charmander": {
        pokemon_type: "fire",
        evolution_stage: "basic",
        tasks_completed: 3,
        tasks_failed: 1,
        tasks_in_flight: 0,
        journals_count: 2,
        channels_active: 1,
        moves_used_freq: { "move-tdd-cycle": 2 }
      }
    })
  );

  // wiki dirs
  mkdirSync(join(vaultPath, "wikis", "_agents", "profiles"), { recursive: true });
  mkdirSync(join(vaultPath, "wikis", "_agents", "trainers"), { recursive: true });
  mkdirSync(join(vaultPath, "wikis", "_agents", "synthesis"), { recursive: true });

  // Trainer page: brett has wiki: _agents
  writeFileSync(
    join(vaultPath, "wikis", "_agents", "trainers", "trainer-brett.md"),
    [
      "---",
      "id: trainer-brett",
      "type: trainer",
      "title: Brett",
      "wiki: _agents",
      "trainer_id: trainer-brett",
      "status: active",
      "created: '2026-05-01'",
      "---",
      "Brett the trainer.",
    ].join("\n")
  );

  // Profile file
  writeFileSync(
    join(vaultPath, "wikis", "_agents", "profiles", "profile-charmander.md"),
    [
      "---",
      "id: profile-charmander",
      "type: profile",
      "title: Charmander",
      "wiki: _agents",
      "status: active",
      "created: '2026-05-01'",
      "updated: '2026-05-01'",
      "pokemon: charmander",
      "evolution_stage: basic",
      "summary: Fire starter",
      "tags: [profile]",
      "---",
      "Body.",
    ].join("\n")
  );

  // stadium.toml: active = "brett" plus a [trainer.brett] section with api_key
  // This satisfies both resolveTrainerContext (active slug) and resolveStadiumConfig ([trainer.brett])
  mkdirSync(join(homePath, ".vault"), { recursive: true });
  writeFileSync(
    join(homePath, ".vault", "stadium.toml"),
    [
      'active = "brett"',
      "",
      "[trainer.brett]",
      'api_key = "sk-test"',
      'base_url = "https://api.test"',
    ].join("\n")
  );

  return { vaultPath, homePath };
}

/** Trainer page with no wiki: field */
function makeTrainerNoWiki(vaultPath: string): void {
  writeFileSync(
    join(vaultPath, "wikis", "_agents", "trainers", "trainer-brett.md"),
    [
      "---",
      "id: trainer-brett",
      "type: trainer",
      "title: Brett",
      "trainer_id: trainer-brett",
      "status: active",
      "created: '2026-05-01'",
      "---",
      "No wiki field.",
    ].join("\n")
  );
}

// ─── profile-register ─────────────────────────────────────────────────────────

describe("profile-register wiki resolution", () => {
  let vaultPath: string;
  let homePath: string;

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    ({ vaultPath, homePath } = makeVault());
    process.env.VAULT_PATH = vaultPath;
    process.env.STADIUM_HOME = homePath;
    // Do NOT set STADIUM_TRAINER or STADIUM_API_KEY — those come from the toml
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    rmSync(homePath, { recursive: true, force: true });
    delete process.env.VAULT_PATH;
    delete process.env.STADIUM_HOME;
  });

  it("resolves wiki from trainer context (regression for synthesis A2 — no more wiki=alpha default)", async () => {
    // The old code defaulted to wiki=alpha; with resolveTrainerContext it should
    // use the trainer's wiki field (_agents) without needing an explicit wiki: arg.
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            profile_id: "pf_1",
            stats: { hp: 39, atk: 52, def: 43, spd: 65, types: ["fire"] }
          }),
          { status: 200 }
        )
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const { profileRegisterTool } = await import(
      "../../src/tools/profile-register.js"
    );
    // No wiki: arg and no ctx.defaultWiki — wiki must come from trainer context
    const out = await profileRegisterTool.handler(
      { profile_id: "profile-charmander" },
      { vaultPath }
    );
    expect(out.profile_id).toBe("pf_1");
    expect(out.caller_trainer_id).toBe("trainer-brett");
  });

  it("explicit wiki: arg wins over resolved trainer wiki", async () => {
    // Create the alpha wiki profile so explicit routing has a target
    mkdirSync(join(vaultPath, "wikis", "alpha", "profiles"), { recursive: true });
    writeFileSync(
      join(vaultPath, "wikis", "alpha", "profiles", "profile-charmander.md"),
      [
        "---",
        "id: profile-charmander",
        "type: profile",
        "title: Charmander (alpha)",
        "wiki: alpha",
        "status: active",
        "created: '2026-05-01'",
        "updated: '2026-05-01'",
        "pokemon: charmander",
        "evolution_stage: basic",
        "summary: alpha version",
        "tags: [profile]",
        "---",
        "Alpha body.",
      ].join("\n")
    );
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            profile_id: "pf_alpha",
            stats: { hp: 39, atk: 52, def: 43, spd: 65, types: ["fire"] }
          }),
          { status: 200 }
        )
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const { profileRegisterTool } = await import(
      "../../src/tools/profile-register.js"
    );
    // Explicit wiki: alpha should win over resolved _agents wiki from trainer context
    const out = await profileRegisterTool.handler(
      { profile_id: "profile-charmander", wiki: "alpha" },
      { vaultPath }
    );
    expect(out.profile_id).toBe("pf_alpha");
    expect(out.caller_trainer_id).toBe("trainer-brett");
  });

  it("throws TRAINER_WIKI_UNSET when trainer has no wiki: field and no explicit wiki arg", async () => {
    makeTrainerNoWiki(vaultPath);
    vi.stubGlobal("fetch", vi.fn());
    const { profileRegisterTool } = await import(
      "../../src/tools/profile-register.js"
    );
    await expect(
      profileRegisterTool.handler(
        { profile_id: "profile-charmander" },
        { vaultPath }
      )
    ).rejects.toThrow("TRAINER_WIKI_UNSET");
  });

  it("throws NO_ACTIVE_TRAINER when no trainer configured and no explicit wiki arg (Issue 1 — forbidden fallback eliminated)", async () => {
    // Vault has no active trainer in stadium.toml — the old code fell back to
    // ctx.defaultWiki / .active-wiki; the new contract requires propagation.
    const { vaultPath: noTrainerVault, homePath: noTrainerHome } = makeVaultNoTrainer();
    process.env.VAULT_PATH = noTrainerVault;
    process.env.STADIUM_HOME = noTrainerHome;
    vi.stubGlobal("fetch", vi.fn());
    const { profileRegisterTool } = await import(
      "../../src/tools/profile-register.js"
    );
    await expect(
      profileRegisterTool.handler(
        { profile_id: "profile-charmander" },
        { vaultPath: noTrainerVault }
      )
    ).rejects.toThrow("NO_ACTIVE_TRAINER");
    rmSync(noTrainerVault, { recursive: true, force: true });
    rmSync(noTrainerHome, { recursive: true, force: true });
  });

  it("explicit wiki: arg works even when no trainer configured (Issue 1 — short-circuits trainer resolution)", async () => {
    // When an explicit wiki: arg is provided, it must work without a configured trainer.
    const { vaultPath: noTrainerVault, homePath: noTrainerHome } = makeVaultNoTrainer();
    process.env.VAULT_PATH = noTrainerVault;
    process.env.STADIUM_HOME = noTrainerHome;
    // Supply API key via env so resolveStadiumConfig() succeeds (no active trainer in toml)
    process.env.STADIUM_API_KEY = "sk-env-test";
    process.env.STADIUM_BASE_URL = "https://api.test";
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            profile_id: "pf_direct",
            stats: { hp: 39, atk: 52, def: 43, spd: 65, types: ["fire"] }
          }),
          { status: 200 }
        )
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const { profileRegisterTool } = await import(
      "../../src/tools/profile-register.js"
    );
    const out = await profileRegisterTool.handler(
      { profile_id: "profile-charmander", wiki: "_agents" },
      { vaultPath: noTrainerVault }
    );
    expect(out.profile_id).toBe("pf_direct");
    // No trainer configured so caller_trainer_id is undefined
    expect(out.caller_trainer_id).toBeUndefined();
    rmSync(noTrainerVault, { recursive: true, force: true });
    rmSync(noTrainerHome, { recursive: true, force: true });
    delete process.env.STADIUM_API_KEY;
    delete process.env.STADIUM_BASE_URL;
  });
});

// ─── profile-stats ────────────────────────────────────────────────────────────

describe("profile-stats wiki resolution", () => {
  let vaultPath: string;
  let homePath: string;

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    ({ vaultPath, homePath } = makeVault());
    process.env.VAULT_PATH = vaultPath;
    process.env.STADIUM_HOME = homePath;
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    rmSync(homePath, { recursive: true, force: true });
    delete process.env.VAULT_PATH;
    delete process.env.STADIUM_HOME;
  });

  it("includes caller_trainer_id in response", async () => {
    const { profileStatsTool } = await import(
      "../../src/tools/profile-stats.js"
    );
    const out = await profileStatsTool.handler(
      { pokemon_id: "profile-charmander" },
      { vaultPath }
    );
    expect(out.caller_trainer_id).toBe("trainer-brett");
    expect(out.profile_id).toBe("profile-charmander");
  });

  it("throws TRAINER_WIKI_UNSET when trainer has no wiki: field", async () => {
    makeTrainerNoWiki(vaultPath);
    const { profileStatsTool } = await import(
      "../../src/tools/profile-stats.js"
    );
    await expect(
      profileStatsTool.handler(
        { pokemon_id: "profile-charmander" },
        { vaultPath }
      )
    ).rejects.toThrow("TRAINER_WIKI_UNSET");
  });

  it("accepts explicit wiki: arg that wins over trainer wiki (Issue 2 fix) — routes to explicit wiki and reads created date", async () => {
    // Mirror the parallel tests for refresh-profile-memory and evolve-profile:
    // place profile-charmander under some-other-wiki with a past created: date,
    // then assert days_since_creation > 0 (proves routing reached some-other-wiki).
    // Also add profile-charmander to profiles.json so stats lookup succeeds.
    mkdirSync(join(vaultPath, "wikis", "some-other-wiki", "profiles"), { recursive: true });
    writeFileSync(
      join(vaultPath, "wikis", "some-other-wiki", "profiles", "profile-charmander.md"),
      [
        "---",
        "id: profile-charmander",
        "type: profile",
        "title: Charmander (some-other-wiki copy)",
        "wiki: some-other-wiki",
        "status: active",
        "created: '2026-01-01'",
        "updated: '2026-01-01'",
        "pokemon: charmander",
        "evolution_stage: basic",
        "summary: Fire starter in some-other-wiki",
        "tags: [profile]",
        "---",
        "Body.",
      ].join("\n")
    );
    const { profileStatsTool } = await import(
      "../../src/tools/profile-stats.js"
    );
    const out = await profileStatsTool.handler(
      { pokemon_id: "profile-charmander", wiki: "some-other-wiki" } as any,
      { vaultPath }
    );
    // Should succeed and return stats (the wiki: arg overrides trainer wiki)
    expect(out.profile_id).toBe("profile-charmander");
    expect(out.caller_trainer_id).toBe("trainer-brett");
    // Profile was created 2026-01-01 → days_since_creation > 0 proves routing
    // actually reached some-other-wiki (not _agents which has created:'2026-05-01' too
    // but the key point is this profile ONLY has old created date in some-other-wiki)
    expect(out.days_since_creation).toBeGreaterThan(0);
  });

  it("throws NO_ACTIVE_TRAINER when no trainer configured and no explicit wiki: arg (Issue 2 fix)", async () => {
    const { vaultPath: noTrainerVault, homePath: noTrainerHome } = makeVaultNoTrainer();
    process.env.VAULT_PATH = noTrainerVault;
    process.env.STADIUM_HOME = noTrainerHome;
    const { profileStatsTool } = await import(
      "../../src/tools/profile-stats.js"
    );
    await expect(
      profileStatsTool.handler(
        { pokemon_id: "profile-charmander" },
        { vaultPath: noTrainerVault }
      )
    ).rejects.toThrow("NO_ACTIVE_TRAINER");
    rmSync(noTrainerVault, { recursive: true, force: true });
    rmSync(noTrainerHome, { recursive: true, force: true });
  });

  it("explicit wiki: arg actually routes to the explicit wiki path (no-trainer, real routing verification)", async () => {
    // Issue 2: after the _wiki -> wiki fix, the tool must actually read profile
    // data from wikis/some-other-wiki/profiles/profile-pikachu.md.
    // The profile-pikachu page is created ONLY in some-other-wiki (not in _agents)
    // and has created:'2026-01-01' so days_since_creation > 0.
    // Before the fix: readProfile(vaultPath, "profile-pikachu") throws
    // ProfileNotFoundError (caught), daysSinceCreation stays 0 → test FAILS.
    // After the fix: reads from some-other-wiki path → days_since_creation > 0 → PASSES.
    const { vaultPath: noTrainerVault, homePath: noTrainerHome } = makeVaultNoTrainer();
    process.env.VAULT_PATH = noTrainerVault;
    process.env.STADIUM_HOME = noTrainerHome;

    // Add profile-pikachu to profiles.json (stats index)
    writeFileSync(
      join(noTrainerVault, "_index", "profiles.json"),
      JSON.stringify({
        "profile-pikachu": {
          pokemon_type: "electric",
          evolution_stage: "stage1",
          tasks_completed: 5,
          tasks_failed: 0,
          tasks_in_flight: 0,
          journals_count: 3,
          channels_active: 2,
          moves_used_freq: {}
        }
      })
    );
    // Create profile page ONLY in some-other-wiki (not in _agents)
    mkdirSync(join(noTrainerVault, "wikis", "some-other-wiki", "profiles"), { recursive: true });
    writeFileSync(
      join(noTrainerVault, "wikis", "some-other-wiki", "profiles", "profile-pikachu.md"),
      [
        "---",
        "id: profile-pikachu",
        "type: profile",
        "title: Pikachu",
        "wiki: some-other-wiki",
        "status: active",
        "created: '2026-01-01'",
        "updated: '2026-01-01'",
        "pokemon: pikachu",
        "evolution_stage: stage1",
        "summary: Electric mouse",
        "tags: [profile]",
        "---",
        "Body.",
      ].join("\n")
    );

    const { profileStatsTool } = await import(
      "../../src/tools/profile-stats.js"
    );
    const out = await profileStatsTool.handler(
      { pokemon_id: "profile-pikachu", wiki: "some-other-wiki" } as any,
      { vaultPath: noTrainerVault }
    );
    expect(out.profile_id).toBe("profile-pikachu");
    expect(out.caller_trainer_id).toBeUndefined();
    // Profile was created 2026-01-01 → days_since_creation > 0 proves routing
    // actually reached some-other-wiki (not the fallback _agents path which has no pikachu)
    expect(out.days_since_creation).toBeGreaterThan(0);
    rmSync(noTrainerVault, { recursive: true, force: true });
    rmSync(noTrainerHome, { recursive: true, force: true });
  });
});

// ─── refresh-profile-memory ───────────────────────────────────────────────────

describe("refresh-profile-memory wiki resolution", () => {
  let vaultPath: string;
  let homePath: string;

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    ({ vaultPath, homePath } = makeVault());
    process.env.VAULT_PATH = vaultPath;
    process.env.STADIUM_HOME = homePath;
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    rmSync(homePath, { recursive: true, force: true });
    delete process.env.VAULT_PATH;
    delete process.env.STADIUM_HOME;
  });

  it("includes caller_trainer_id in response", async () => {
    const { refreshProfileMemoryTool } = await import(
      "../../src/tools/refresh-profile-memory.js"
    );
    const out = await refreshProfileMemoryTool.handler(
      { pokemon_id: "profile-charmander" },
      { vaultPath }
    );
    expect(out.caller_trainer_id).toBe("trainer-brett");
  });

  it("throws TRAINER_WIKI_UNSET when trainer has no wiki: field", async () => {
    makeTrainerNoWiki(vaultPath);
    const { refreshProfileMemoryTool } = await import(
      "../../src/tools/refresh-profile-memory.js"
    );
    await expect(
      refreshProfileMemoryTool.handler(
        { pokemon_id: "profile-charmander" },
        { vaultPath }
      )
    ).rejects.toThrow("TRAINER_WIKI_UNSET");
  });

  it("accepts explicit wiki: arg that wins over trainer wiki (Issue 2 fix)", async () => {
    // Set up profile-charmander in some-other-wiki so the tool can route there.
    // The trainer's wiki is _agents; this confirms explicit wiki: wins.
    mkdirSync(join(vaultPath, "wikis", "some-other-wiki", "profiles"), { recursive: true });
    mkdirSync(join(vaultPath, "wikis", "some-other-wiki", "synthesis"), { recursive: true });
    writeFileSync(
      join(vaultPath, "wikis", "some-other-wiki", "profiles", "profile-charmander.md"),
      [
        "---",
        "id: profile-charmander",
        "type: profile",
        "title: Charmander (some-other-wiki copy)",
        "wiki: some-other-wiki",
        "status: active",
        "created: '2026-05-01'",
        "updated: '2026-05-01'",
        "pokemon: charmander",
        "evolution_stage: basic",
        "summary: Fire starter in some-other-wiki",
        "tags: [profile]",
        "---",
        "Body.",
      ].join("\n")
    );
    const { refreshProfileMemoryTool } = await import(
      "../../src/tools/refresh-profile-memory.js"
    );
    const out = await refreshProfileMemoryTool.handler(
      { pokemon_id: "profile-charmander", wiki: "some-other-wiki" } as any,
      { vaultPath }
    );
    // Explicit wiki: some-other-wiki routes correctly; trainer resolves for caller_trainer_id
    expect(out.caller_trainer_id).toBe("trainer-brett");
  });

  it("throws NO_ACTIVE_TRAINER when no trainer configured and no explicit wiki: arg (Issue 2 fix)", async () => {
    const { vaultPath: noTrainerVault, homePath: noTrainerHome } = makeVaultNoTrainer();
    process.env.VAULT_PATH = noTrainerVault;
    process.env.STADIUM_HOME = noTrainerHome;
    const { refreshProfileMemoryTool } = await import(
      "../../src/tools/refresh-profile-memory.js"
    );
    await expect(
      refreshProfileMemoryTool.handler(
        { pokemon_id: "profile-charmander" },
        { vaultPath: noTrainerVault }
      )
    ).rejects.toThrow("NO_ACTIVE_TRAINER");
    rmSync(noTrainerVault, { recursive: true, force: true });
    rmSync(noTrainerHome, { recursive: true, force: true });
  });

  it("explicit wiki: arg actually routes to the explicit wiki path (no-trainer, real routing verification)", async () => {
    // Issue 2: after the _wiki -> wiki fix, the tool must verify profile existence
    // from wikis/some-other-wiki/profiles/profile-pikachu.md.
    // profile-pikachu is ONLY in some-other-wiki (not in _agents).
    // Before the fix: readProfile(vaultPath, "profile-pikachu") throws ProfileNotFoundError
    // → test FAILS (profile not found).
    // After the fix: existence check uses wikis/some-other-wiki path → PASSES.
    const { vaultPath: noTrainerVault, homePath: noTrainerHome } = makeVaultNoTrainer();
    process.env.VAULT_PATH = noTrainerVault;
    process.env.STADIUM_HOME = noTrainerHome;

    // Create profile page ONLY in some-other-wiki (not in _agents)
    mkdirSync(join(noTrainerVault, "wikis", "some-other-wiki", "profiles"), { recursive: true });
    // Also need synthesis dir for the output
    mkdirSync(join(noTrainerVault, "wikis", "some-other-wiki", "synthesis"), { recursive: true });
    writeFileSync(
      join(noTrainerVault, "wikis", "some-other-wiki", "profiles", "profile-pikachu.md"),
      [
        "---",
        "id: profile-pikachu",
        "type: profile",
        "title: Pikachu",
        "wiki: some-other-wiki",
        "status: active",
        "created: '2026-01-01'",
        "updated: '2026-01-01'",
        "pokemon: pikachu",
        "evolution_stage: stage1",
        "summary: Electric mouse",
        "tags: [profile]",
        "---",
        "Body.",
      ].join("\n")
    );

    const { refreshProfileMemoryTool } = await import(
      "../../src/tools/refresh-profile-memory.js"
    );
    const out = await refreshProfileMemoryTool.handler(
      { pokemon_id: "profile-pikachu", wiki: "some-other-wiki" } as any,
      { vaultPath: noTrainerVault }
    );
    // No trainer → caller_trainer_id is undefined
    expect(out.caller_trainer_id).toBeUndefined();
    // memory_page_id confirms the synthesis was written
    expect(out.memory_page_id).toContain("pikachu");
    rmSync(noTrainerVault, { recursive: true, force: true });
    rmSync(noTrainerHome, { recursive: true, force: true });
  });
});

// ─── evolve-profile ───────────────────────────────────────────────────────────

describe("evolve-profile wiki resolution", () => {
  let vaultPath: string;
  let homePath: string;

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    ({ vaultPath, homePath } = makeVault());
    process.env.VAULT_PATH = vaultPath;
    process.env.STADIUM_HOME = homePath;
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    rmSync(homePath, { recursive: true, force: true });
    delete process.env.VAULT_PATH;
    delete process.env.STADIUM_HOME;
  });

  it("includes caller_trainer_id in proposal-phase response", async () => {
    const { evolveProfileTool } = await import(
      "../../src/tools/evolve-profile.js"
    );
    const out = await evolveProfileTool.handler(
      { pokemon_id: "profile-charmander", commit: false },
      { vaultPath, today: new Date("2026-05-04") }
    );
    expect((out as any).caller_trainer_id).toBe("trainer-brett");
  });

  it("throws TRAINER_WIKI_UNSET when trainer has no wiki: field", async () => {
    makeTrainerNoWiki(vaultPath);
    const { evolveProfileTool } = await import(
      "../../src/tools/evolve-profile.js"
    );
    await expect(
      evolveProfileTool.handler(
        { pokemon_id: "profile-charmander", commit: false },
        { vaultPath }
      )
    ).rejects.toThrow("TRAINER_WIKI_UNSET");
  });

  it("accepts explicit wiki: arg that wins over trainer wiki (Issue 2 fix)", async () => {
    // Set up profile-charmander in some-other-wiki so the tool can route there.
    // The trainer's wiki is _agents; this confirms explicit wiki: wins.
    mkdirSync(join(vaultPath, "wikis", "some-other-wiki", "profiles"), { recursive: true });
    writeFileSync(
      join(vaultPath, "wikis", "some-other-wiki", "profiles", "profile-charmander.md"),
      [
        "---",
        "id: profile-charmander",
        "type: profile",
        "title: Charmander (some-other-wiki copy)",
        "wiki: some-other-wiki",
        "status: active",
        "created: '2026-05-01'",
        "updated: '2026-05-01'",
        "pokemon: charmander",
        "evolution_stage: basic",
        "pokemon_type: fire",
        "autonomy_level: restricted",
        "moveset: []",
        "summary: Fire starter in some-other-wiki",
        "tags: [profile]",
        "---",
        "Body.",
      ].join("\n")
    );
    const { evolveProfileTool } = await import(
      "../../src/tools/evolve-profile.js"
    );
    const out = await evolveProfileTool.handler(
      { pokemon_id: "profile-charmander", commit: false, wiki: "some-other-wiki" } as any,
      { vaultPath, today: new Date("2026-05-04") }
    );
    // Explicit wiki: some-other-wiki routes correctly; trainer resolves for caller_trainer_id
    expect((out as any).caller_trainer_id).toBe("trainer-brett");
    // Proposal reflects data from some-other-wiki path
    expect((out as any).current.evolution_stage).toBe("basic");
  });

  it("throws NO_ACTIVE_TRAINER when no trainer configured and no explicit wiki: arg (Issue 2 fix)", async () => {
    const { vaultPath: noTrainerVault, homePath: noTrainerHome } = makeVaultNoTrainer();
    process.env.VAULT_PATH = noTrainerVault;
    process.env.STADIUM_HOME = noTrainerHome;
    const { evolveProfileTool } = await import(
      "../../src/tools/evolve-profile.js"
    );
    await expect(
      evolveProfileTool.handler(
        { pokemon_id: "profile-charmander", commit: false },
        { vaultPath: noTrainerVault, today: new Date("2026-05-04") }
      )
    ).rejects.toThrow("NO_ACTIVE_TRAINER");
    rmSync(noTrainerVault, { recursive: true, force: true });
    rmSync(noTrainerHome, { recursive: true, force: true });
  });

  it("commit-phase rename uses wiki-scoped path, not hardcoded _agents (Issue 1 fix)", async () => {
    // When commit:true triggers a rename and the resolved wiki is NOT _agents,
    // the old code called renameProfile(...) which looked under wikis/_agents/profiles/
    // → throws ProfileNotFoundError. The fix inlines the rename using wiki-scoped paths.
    //
    // Set up: profile-charmander in some-other-wiki only (NOT in _agents).
    // Trainer wiki is _agents (won't matter — we pass wiki: arg explicitly).
    mkdirSync(join(vaultPath, "wikis", "some-other-wiki", "profiles"), { recursive: true });
    writeFileSync(
      join(vaultPath, "wikis", "some-other-wiki", "profiles", "profile-charmander.md"),
      [
        "---",
        "id: profile-charmander",
        "type: profile",
        "title: Charmander",
        "wiki: some-other-wiki",
        "status: active",
        "created: '2026-05-01'",
        "updated: '2026-05-01'",
        "pokemon: charmander",
        "evolution_stage: basic",
        "pokemon_type: fire",
        "autonomy_level: restricted",
        "moveset: []",
        "summary: Fire starter",
        "tags: [profile]",
        "---",
        "Body.",
      ].join("\n")
    );
    const { evolveProfileTool } = await import(
      "../../src/tools/evolve-profile.js"
    );
    // commit:true with a proposal that includes a name rename
    const proposal = {
      eligible: true,
      reason: "meets thresholds",
      current: {
        name: "profile-charmander",
        evolution_stage: "basic" as const,
        moveset: [],
        autonomy_level: "restricted"
      },
      proposed: {
        name: "profile-charmeleon",
        evolution_stage: "stage1" as const,
        moveset_additions: [],
        moveset_removals: [],
        autonomy_level: "feature-branch" as const,
        moveset_suggestions: [],
        specialties: []
      },
      rationale: "test evolution"
    };
    const out = await evolveProfileTool.handler(
      {
        pokemon_id: "profile-charmander",
        commit: true,
        expected_updated: "2026-05-01",
        proposal,
        wiki: "some-other-wiki",
        cleanup_old_skills_dir: false
      } as any,
      { vaultPath, today: new Date("2026-05-04") }
    );
    // The rename should succeed and return new_id in the correct wiki
    expect((out as any).new_id).toBe("profile-charmeleon");
    expect((out as any).old_id).toBe("profile-charmander");
    // The renamed file should exist in some-other-wiki, NOT in _agents
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(vaultPath, "wikis", "some-other-wiki", "profiles", "profile-charmeleon.md"))).toBe(true);
    expect(existsSync(join(vaultPath, "wikis", "_agents", "profiles", "profile-charmeleon.md"))).toBe(false);
  });

  it("explicit wiki: arg actually routes to the explicit wiki path (no-trainer, real routing verification)", async () => {
    // Issue 2: after the _wiki -> wiki fix, the tool must read the profile
    // from wikis/some-other-wiki/profiles/profile-pikachu.md.
    // profile-pikachu is ONLY in some-other-wiki (not in _agents).
    // Before the fix: readProfile(vaultPath, "profile-pikachu") throws ProfileNotFoundError
    // → test FAILS.
    // After the fix: reads from some-other-wiki path → proposal returned with pikachu data.
    const { vaultPath: noTrainerVault, homePath: noTrainerHome } = makeVaultNoTrainer();
    process.env.VAULT_PATH = noTrainerVault;
    process.env.STADIUM_HOME = noTrainerHome;

    // Add profile-pikachu to profiles.json (needed for profileStatsTool sub-call)
    writeFileSync(
      join(noTrainerVault, "_index", "profiles.json"),
      JSON.stringify({
        "profile-pikachu": {
          pokemon_type: "electric",
          evolution_stage: "stage1",
          tasks_completed: 5,
          tasks_failed: 0,
          tasks_in_flight: 0,
          journals_count: 3,
          channels_active: 2,
          moves_used_freq: {}
        }
      })
    );
    // Create profile page ONLY in some-other-wiki (not in _agents)
    mkdirSync(join(noTrainerVault, "wikis", "some-other-wiki", "profiles"), { recursive: true });
    writeFileSync(
      join(noTrainerVault, "wikis", "some-other-wiki", "profiles", "profile-pikachu.md"),
      [
        "---",
        "id: profile-pikachu",
        "type: profile",
        "title: Pikachu",
        "wiki: some-other-wiki",
        "status: active",
        "created: '2026-01-01'",
        "updated: '2026-01-01'",
        "pokemon: pikachu",
        "evolution_stage: stage1",
        "pokemon_type: electric",
        "autonomy_level: feature-branch",
        "moveset: []",
        "summary: Electric mouse",
        "tags: [profile]",
        "---",
        "Body.",
      ].join("\n")
    );

    const { evolveProfileTool } = await import(
      "../../src/tools/evolve-profile.js"
    );
    const out = await evolveProfileTool.handler(
      { pokemon_id: "profile-pikachu", commit: false, wiki: "some-other-wiki" } as any,
      { vaultPath: noTrainerVault, today: new Date("2026-05-04") }
    );
    // No trainer → caller_trainer_id is undefined
    expect((out as any).caller_trainer_id).toBeUndefined();
    // Proposal reflects pikachu's data from some-other-wiki path
    expect((out as any).current.evolution_stage).toBe("stage1");
    rmSync(noTrainerVault, { recursive: true, force: true });
    rmSync(noTrainerHome, { recursive: true, force: true });
  });
});
