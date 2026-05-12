import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { suggestByType } from "../../src/core/pokeapi.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// A type response with water pokemon: squirtle (basic), wartortle (stage1), blastoise (stage2)
const waterTypeResponse = {
  pokemon: [
    { pokemon: { name: "squirtle",  url: "https://pokeapi.co/api/v2/pokemon/7/"  } },
    { pokemon: { name: "wartortle", url: "https://pokeapi.co/api/v2/pokemon/8/"  } },
    { pokemon: { name: "blastoise", url: "https://pokeapi.co/api/v2/pokemon/9/"  } },
    { pokemon: { name: "psyduck",   url: "https://pokeapi.co/api/v2/pokemon/54/" } },
  ]
};

// Species endpoint responses.
// squirtle: basic  — evolves_from_species: null
// wartortle: stage1 — evolves_from_species: { name: "squirtle", url: "..." }
// blastoise: stage2 — evolves_from_species: { name: "wartortle", url: "..." }
// psyduck: basic  — evolves_from_species: null
// squirtle (used by wartortle's predecessor check) already handled above

const speciesSquirtle  = { name: "squirtle",  evolves_from_species: null };
const speciesWartortle = {
  name: "wartortle",
  evolves_from_species: { name: "squirtle", url: "https://pokeapi.co/api/v2/pokemon-species/7/" }
};
const speciesBlastoise = {
  name: "blastoise",
  evolves_from_species: { name: "wartortle", url: "https://pokeapi.co/api/v2/pokemon-species/8/" }
};
const speciesPsyduck   = { name: "psyduck", evolves_from_species: null };

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("suggestByType — evolution_stage filter", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-evo-filter-"));
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("returns all candidates when evolution_stage is not supplied", async () => {
    const fetcher = makeFetcher({
      "/type/water": waterTypeResponse,
    });
    const results = await suggestByType(vaultPath, "water", { fetcher });
    expect(results.length).toBe(4);
    expect(results.map(r => r.name)).toContain("blastoise");
    expect(results.map(r => r.name)).toContain("wartortle");
  });

  it("returns only basic-stage pokemon when evolution_stage is 'basic'", async () => {
    const fetcher = makeFetcher({
      "/type/water": waterTypeResponse,
      "/pokemon-species/squirtle":  speciesSquirtle,
      "/pokemon-species/wartortle": speciesWartortle,
      "/pokemon-species/blastoise": speciesBlastoise,
      "/pokemon-species/psyduck":   speciesPsyduck,
    });

    const results = await suggestByType(vaultPath, "water", { fetcher, evolution_stage: "basic" });

    const names = results.map(r => r.name);
    expect(names).toContain("squirtle");
    expect(names).toContain("psyduck");
    expect(names).not.toContain("wartortle");
    expect(names).not.toContain("blastoise");
  });

  it("excludes a candidate whose species fetch fails rather than crashing", async () => {
    // Only squirtle species resolves successfully; others 404
    const fetcher = makeFetcher({
      "/type/water": {
        pokemon: [
          { pokemon: { name: "squirtle",  url: "https://pokeapi.co/api/v2/pokemon/7/" } },
          { pokemon: { name: "wartortle", url: "https://pokeapi.co/api/v2/pokemon/8/" } },
        ]
      },
      "/pokemon-species/squirtle": speciesSquirtle,
      // wartortle intentionally missing — will 404
    });

    const results = await suggestByType(vaultPath, "water", { fetcher, evolution_stage: "basic" });

    const names = results.map(r => r.name);
    // squirtle passes (basic), wartortle excluded because fetch failed
    expect(names).toContain("squirtle");
    expect(names).not.toContain("wartortle");
  });

  it("caches species data under 'species:<name>' key", async () => {
    let fetchCount = 0;
    const counting: typeof fetch = (async (url: string | URL | Request) => {
      fetchCount++;
      const u = String(url);
      if (u.includes("/type/water")) return new Response(JSON.stringify({
        pokemon: [{ pokemon: { name: "squirtle", url: "https://pokeapi.co/api/v2/pokemon/7/" } }]
      }), { status: 200 });
      if (u.includes("/pokemon-species/squirtle")) return new Response(JSON.stringify(speciesSquirtle), { status: 200 });
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    // First call — should hit species endpoint once
    await suggestByType(vaultPath, "water", { fetcher: counting, evolution_stage: "basic" });
    const firstCallCount = fetchCount;

    // Second call — type result is cached AND species result is cached; zero new fetches
    await suggestByType(vaultPath, "water", { fetcher: counting, evolution_stage: "basic" });
    expect(fetchCount).toBe(firstCallCount); // no new network calls
  });

  it("stage1 filter returns only first-evolution pokemon", async () => {
    const fetcher = makeFetcher({
      "/type/water": waterTypeResponse,
      "/pokemon-species/squirtle":  speciesSquirtle,
      "/pokemon-species/wartortle": speciesWartortle,
      "/pokemon-species/blastoise": speciesBlastoise,
      "/pokemon-species/psyduck":   speciesPsyduck,
    });

    const results = await suggestByType(vaultPath, "water", { fetcher, evolution_stage: "stage1" });

    const names = results.map(r => r.name);
    expect(names).toContain("wartortle");
    expect(names).not.toContain("squirtle");
    expect(names).not.toContain("blastoise");
    expect(names).not.toContain("psyduck");
  });

  it("stage2 filter returns only second-evolution pokemon", async () => {
    const fetcher = makeFetcher({
      "/type/water": waterTypeResponse,
      "/pokemon-species/squirtle":  speciesSquirtle,
      "/pokemon-species/wartortle": speciesWartortle,
      "/pokemon-species/blastoise": speciesBlastoise,
      "/pokemon-species/psyduck":   speciesPsyduck,
    });

    const results = await suggestByType(vaultPath, "water", { fetcher, evolution_stage: "stage2" });

    const names = results.map(r => r.name);
    expect(names).toContain("blastoise");
    expect(names).not.toContain("squirtle");
    expect(names).not.toContain("wartortle");
    expect(names).not.toContain("psyduck");
  });
});
