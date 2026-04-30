import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { suggestPokemonTool } from "../../src/tools/suggest-pokemon.js";

const fireTypeResponse = {
  pokemon: [
    { pokemon: { name: "charmander", url: "https://pokeapi.co/api/v2/pokemon/4/" } },
    { pokemon: { name: "vulpix",     url: "https://pokeapi.co/api/v2/pokemon/37/" } },
    { pokemon: { name: "growlithe",  url: "https://pokeapi.co/api/v2/pokemon/58/" } }
  ]
};

function makeFetcher(): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("/type/fire")) return new Response(JSON.stringify(fireTypeResponse), { status: 200 });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

describe("vault.suggest-pokemon", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-sp-"));
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
created: 2026-04-29
updated: 2026-04-29
summary: Backend
pokemon_type: fire
evolution_stage: basic
autonomy_level: restricted
moveset: []
applies_to: [claude-code]
---
`);
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("returns candidates for an explicit pokemon_type", async () => {
    const r = await suggestPokemonTool.handler(
      { pokemon_type: "fire", limit: 5 },
      { vaultPath, fetcher: makeFetcher() }
    );
    expect(r.suggestions.length).toBeGreaterThan(0);
    expect(r.suggestions.every(s => s.pokemon_type === "fire")).toBe(true);
  });

  it("excludes existing profiles when exclude_existing=true (default)", async () => {
    const r = await suggestPokemonTool.handler(
      { pokemon_type: "fire", limit: 10 },
      { vaultPath, fetcher: makeFetcher() }
    );
    expect(r.suggestions.map(s => s.name)).not.toContain("charmander");
  });

  it("translates dev_specialty to pokemon_type (backend → fire)", async () => {
    const r = await suggestPokemonTool.handler(
      { dev_specialty: "backend", limit: 5 },
      { vaultPath, fetcher: makeFetcher() }
    );
    expect(r.suggestions.every(s => s.pokemon_type === "fire")).toBe(true);
  });
});
