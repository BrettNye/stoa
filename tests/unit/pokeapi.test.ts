import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  fetchPokemon,
  fetchEvolutionChain,
  nextEvolution,
  suggestByType
} from "../../src/core/pokeapi.js";

const charmanderResponse = {
  name: "charmander",
  types: [{ type: { name: "fire" } }],
  species: { url: "https://pokeapi.co/api/v2/pokemon-species/4/" },
  sprites: { front_default: "https://example.com/charmander.png" }
};

const speciesCharmanderResponse = {
  evolution_chain: { url: "https://pokeapi.co/api/v2/evolution-chain/2/" }
};

const chainResponse = {
  chain: {
    species: { name: "charmander", url: "https://pokeapi.co/api/v2/pokemon-species/4/" },
    evolves_to: [{
      species: { name: "charmeleon", url: "https://pokeapi.co/api/v2/pokemon-species/5/" },
      evolves_to: [{
        species: { name: "charizard", url: "https://pokeapi.co/api/v2/pokemon-species/6/" },
        evolves_to: []
      }]
    }]
  }
};

const fireTypeResponse = {
  pokemon: [
    { pokemon: { name: "charmander", url: "https://pokeapi.co/api/v2/pokemon/4/" } },
    { pokemon: { name: "vulpix",     url: "https://pokeapi.co/api/v2/pokemon/37/" } }
  ]
};

function makeFetcher(routes: Record<string, any>): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = String(url);
    for (const [pattern, body] of Object.entries(routes)) {
      if (u.includes(pattern)) {
        return new Response(JSON.stringify(body), { status: 200 });
      }
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

describe("pokeapi — fetchPokemon", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-pokeapi-"));
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("fetches Pokemon details and writes to cache", async () => {
    const fetcher = makeFetcher({
      "/pokemon/charmander": charmanderResponse,
      "/pokemon-species/4/": speciesCharmanderResponse
    });
    const r = await fetchPokemon(vaultPath, "charmander", { fetcher });
    expect(r.name).toBe("charmander");
    expect(r.types).toContain("fire");
    expect(r.evolution_chain_url).toContain("evolution-chain/2");
    expect(r.sprite_url).toContain("charmander.png");

    const cache = JSON.parse(readFileSync(join(vaultPath, "_index", "pokeapi-cache.json"), "utf8"));
    expect(cache["pokemon:charmander"]).toBeDefined();
    expect(cache["pokemon:charmander"].value.name).toBe("charmander");
  });

  it("hits cache on second call (no fetch)", async () => {
    let fetchCount = 0;
    const counting: typeof fetch = (async (url: string | URL | Request) => {
      fetchCount++;
      const u = String(url);
      if (u.includes("/pokemon/charmander")) return new Response(JSON.stringify(charmanderResponse), { status: 200 });
      if (u.includes("/pokemon-species/4/")) return new Response(JSON.stringify(speciesCharmanderResponse), { status: 200 });
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    await fetchPokemon(vaultPath, "charmander", { fetcher: counting });
    const before = fetchCount;
    await fetchPokemon(vaultPath, "charmander", { fetcher: counting });
    expect(fetchCount).toBe(before);
  });
});

describe("pokeapi — fetchEvolutionChain + nextEvolution", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-pokeapi-"));
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("flattens an evolution chain into ordered stages", async () => {
    const fetcher = makeFetcher({
      "/evolution-chain/2/": chainResponse
    });
    const r = await fetchEvolutionChain(vaultPath, "https://pokeapi.co/api/v2/evolution-chain/2/", { fetcher });
    expect(r.stages.map(s => s.name)).toEqual(["charmander", "charmeleon", "charizard"]);
  });

  it("nextEvolution returns the chain successor by name", async () => {
    const fetcher = makeFetcher({
      "/pokemon/charmander": charmanderResponse,
      "/pokemon-species/4/": speciesCharmanderResponse,
      "/evolution-chain/2/": chainResponse
    });
    const r = await nextEvolution(vaultPath, "charmander", { fetcher });
    expect(r?.name).toBe("charmeleon");
  });

  it("nextEvolution returns null when current is the chain terminal", async () => {
    const charizardResponse = {
      name: "charizard",
      types: [{ type: { name: "fire" } }, { type: { name: "flying" } }],
      species: { url: "https://pokeapi.co/api/v2/pokemon-species/6/" },
      sprites: { front_default: null }
    };
    const speciesCharizardResponse = {
      evolution_chain: { url: "https://pokeapi.co/api/v2/evolution-chain/2/" }
    };
    const fetcher = makeFetcher({
      "/pokemon/charizard": charizardResponse,
      "/pokemon-species/6/": speciesCharizardResponse,
      "/evolution-chain/2/": chainResponse
    });
    const r = await nextEvolution(vaultPath, "charizard", { fetcher });
    expect(r).toBeNull();
  });
});

describe("pokeapi — suggestByType", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-pokeapi-"));
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("returns candidates for a given type", async () => {
    const fetcher = makeFetcher({
      "/type/fire": fireTypeResponse
    });
    const r = await suggestByType(vaultPath, "fire", { fetcher });
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].pokemon_type).toBe("fire");
    expect(r.map(c => c.name)).toContain("charmander");
  });
});
