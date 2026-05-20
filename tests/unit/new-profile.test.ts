import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { newProfileTool } from "../../src/tools/new-profile.js";

const fireTypeResponse = {
  pokemon: [
    { pokemon: { name: "vulpix",     url: "https://pokeapi.co/api/v2/pokemon/37/" } },
    { pokemon: { name: "growlithe",  url: "https://pokeapi.co/api/v2/pokemon/58/" } },
    { pokemon: { name: "charmander", url: "https://pokeapi.co/api/v2/pokemon/4/" } }
  ]
};

function makeFireFetcher(): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("/type/fire")) return new Response(JSON.stringify(fireTypeResponse), { status: 200 });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

function seedVault(): string {
  const vault = mkdtempSync(join(tmpdir(), "vault-newprofile-unit-"));
  mkdirSync(join(vault, "wikis", "_agents", "profiles"), { recursive: true });
  mkdirSync(join(vault, "_index"), { recursive: true });
  writeFileSync(join(vault, "_index", "aliases.json"), "{}");
  return vault;
}

describe("vault_new-profile (unit)", () => {
  let vault: string;

  beforeEach(() => { vault = seedVault(); });
  afterEach(() => { rmSync(vault, { recursive: true, force: true }); });

  it("derives id from an explicit pokemon name", async () => {
    const r = await newProfileTool.handler(
      {
        title: "Backend Agent",
        wiki: "_agents",
        pokemon: "Vulpix",
        pokemon_type: "fire"
      },
      { vaultPath: vault }
    );
    expect(r.id).toBe("profile-vulpix");
    expect(r.pokemon).toBe("vulpix");
    expect(r.profile_summary.pokemon_type).toBe("fire");
    expect(r.profile_summary.evolution_stage).toBe("basic");
  });

  it("rolls a pokemon name from pokemon_type when none given", async () => {
    const r = await newProfileTool.handler(
      {
        title: "Backend Agent",
        wiki: "_agents",
        pokemon_type: "fire"
      },
      { vaultPath: vault, fetcher: makeFireFetcher() }
    );
    expect(r.pokemon).toBeTruthy();
    expect(r.id).toMatch(/^profile-/);
    expect(r.profile_summary.pokemon_type).toBe("fire");
  });

  it("rolls a pokemon name from dev_specialty (backend → fire)", async () => {
    const r = await newProfileTool.handler(
      {
        title: "Backend Agent",
        wiki: "_agents",
        dev_specialty: "backend"
      },
      { vaultPath: vault, fetcher: makeFireFetcher() }
    );
    expect(r.profile_summary.pokemon_type).toBe("fire");
    expect(r.id).toMatch(/^profile-/);
  });

  it("rejects when neither pokemon, pokemon_type, nor dev_specialty is given", async () => {
    await expect(
      newProfileTool.handler(
        { title: "Mystery Agent", wiki: "_agents" },
        { vaultPath: vault }
      )
    ).rejects.toThrow();
  });

  it("applies defaults for evolution_stage, autonomy_level, moveset, applies_to", async () => {
    const r = await newProfileTool.handler(
      {
        title: "Backend Agent",
        wiki: "_agents",
        pokemon: "vulpix",
        pokemon_type: "fire"
      },
      { vaultPath: vault }
    );
    expect(r.profile_summary.evolution_stage).toBe("basic");
    // path is under wikis/_agents/profiles
    expect(r.path.replace(/\\/g, "/")).toContain("wikis/_agents/profiles/profile-vulpix.md");
  });

  it("respects explicit non-default values", async () => {
    const r = await newProfileTool.handler(
      {
        title: "Senior Backend Agent",
        wiki: "_agents",
        pokemon: "charizard",
        pokemon_type: "fire",
        evolution_stage: "stage2",
        autonomy_level: "main-branch",
        moveset: ["move-tdd-cycle"],
        applies_to: ["claude-code", "openclaw"]
      },
      { vaultPath: vault }
    );
    expect(r.profile_summary.evolution_stage).toBe("stage2");
    expect(r.id).toBe("profile-charizard");
  });
});
