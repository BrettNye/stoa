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

  it("accepts explicit wiki: arg that wins over trainer wiki (Issue 2 fix)", async () => {
    // wiki: field must be accepted in the input schema and not cause a parse error.
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

  it("explicit wiki: arg works when no trainer configured (Issue 2 fix)", async () => {
    const { vaultPath: noTrainerVault, homePath: noTrainerHome } = makeVaultNoTrainer();
    process.env.VAULT_PATH = noTrainerVault;
    process.env.STADIUM_HOME = noTrainerHome;
    const { profileStatsTool } = await import(
      "../../src/tools/profile-stats.js"
    );
    const out = await profileStatsTool.handler(
      { pokemon_id: "profile-charmander", wiki: "_agents" } as any,
      { vaultPath: noTrainerVault }
    );
    expect(out.profile_id).toBe("profile-charmander");
    expect(out.caller_trainer_id).toBeUndefined();
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
    const { refreshProfileMemoryTool } = await import(
      "../../src/tools/refresh-profile-memory.js"
    );
    const out = await refreshProfileMemoryTool.handler(
      { pokemon_id: "profile-charmander", wiki: "some-other-wiki" } as any,
      { vaultPath }
    );
    // Should succeed (explicit wiki: arg doesn't cause a parse error)
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

  it("explicit wiki: arg works when no trainer configured (Issue 2 fix)", async () => {
    const { vaultPath: noTrainerVault, homePath: noTrainerHome } = makeVaultNoTrainer();
    process.env.VAULT_PATH = noTrainerVault;
    process.env.STADIUM_HOME = noTrainerHome;
    const { refreshProfileMemoryTool } = await import(
      "../../src/tools/refresh-profile-memory.js"
    );
    const out = await refreshProfileMemoryTool.handler(
      { pokemon_id: "profile-charmander", wiki: "_agents" } as any,
      { vaultPath: noTrainerVault }
    );
    expect(out.caller_trainer_id).toBeUndefined();
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
    const { evolveProfileTool } = await import(
      "../../src/tools/evolve-profile.js"
    );
    const out = await evolveProfileTool.handler(
      { pokemon_id: "profile-charmander", commit: false, wiki: "some-other-wiki" } as any,
      { vaultPath, today: new Date("2026-05-04") }
    );
    // Should succeed (explicit wiki: arg accepted in schema and doesn't cause parse error)
    expect((out as any).caller_trainer_id).toBe("trainer-brett");
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

  it("explicit wiki: arg works when no trainer configured (Issue 2 fix)", async () => {
    const { vaultPath: noTrainerVault, homePath: noTrainerHome } = makeVaultNoTrainer();
    process.env.VAULT_PATH = noTrainerVault;
    process.env.STADIUM_HOME = noTrainerHome;
    const { evolveProfileTool } = await import(
      "../../src/tools/evolve-profile.js"
    );
    const out = await evolveProfileTool.handler(
      { pokemon_id: "profile-charmander", commit: false, wiki: "_agents" } as any,
      { vaultPath: noTrainerVault, today: new Date("2026-05-04") }
    );
    expect((out as any).caller_trainer_id).toBeUndefined();
    rmSync(noTrainerVault, { recursive: true, force: true });
    rmSync(noTrainerHome, { recursive: true, force: true });
  });
});
