import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { mountReadRoutes } from "../../src/transport/ui/routes-read.js";
import type { ReadRoutesCtx } from "../../src/transport/ui/routes-read.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// "frontend" specialty maps to a water-adjacent type — we'll use a stub fetcher
// that returns a mix of basic + evolved water pokemon so the filter is exercised.
const frontendTypeResponse = {
  // The actual type depends on mapDevSpecialty("frontend").
  // We return water pokemon regardless of which URL is called for "type/*".
  pokemon: [
    { pokemon: { name: "squirtle",  url: "https://pokeapi.co/api/v2/pokemon/7/" } },
    { pokemon: { name: "wartortle", url: "https://pokeapi.co/api/v2/pokemon/8/" } },
    { pokemon: { name: "blastoise", url: "https://pokeapi.co/api/v2/pokemon/9/" } },
    { pokemon: { name: "psyduck",   url: "https://pokeapi.co/api/v2/pokemon/54/" } },
  ]
};

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

function makeSpecialtyFetcher(): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("/type/")) {
      return new Response(JSON.stringify(frontendTypeResponse), { status: 200 });
    }
    if (u.includes("/pokemon-species/squirtle"))  return new Response(JSON.stringify(speciesSquirtle),  { status: 200 });
    if (u.includes("/pokemon-species/wartortle")) return new Response(JSON.stringify(speciesWartortle), { status: 200 });
    if (u.includes("/pokemon-species/blastoise")) return new Response(JSON.stringify(speciesBlastoise), { status: 200 });
    if (u.includes("/pokemon-species/psyduck"))   return new Response(JSON.stringify(speciesPsyduck),   { status: 200 });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/agents/suggest — locks to basic-stage Pokemon", () => {
  let vaultPath: string;
  let ctx: ReadRoutesCtx;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-suggest-basic-"));
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    ctx = {
      vaultPath,
      fetcher: makeSpecialtyFetcher(),
      startedAt: new Date().toISOString(),
    };
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("returns only basic-stage Pokemon when queried by specialty", async () => {
    const app = new Hono();
    mountReadRoutes(app, ctx);

    const res = await app.request("/api/agents/suggest?specialty=frontend");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.suggestions).toBeDefined();
    const names: string[] = body.suggestions.map((s: any) => s.name);

    // Basic-stage only
    expect(names).toContain("squirtle");
    expect(names).toContain("psyduck");

    // Evolved forms must NOT appear
    expect(names).not.toContain("wartortle");
    expect(names).not.toContain("blastoise");
  });

  it("returns only basic-stage Pokemon when queried by pokemon_type", async () => {
    const app = new Hono();
    mountReadRoutes(app, ctx);

    // Use "water" — a valid canonical type
    const res = await app.request("/api/agents/suggest?pokemon_type=water");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.suggestions).toBeDefined();
    const names: string[] = body.suggestions.map((s: any) => s.name);

    expect(names).toContain("squirtle");
    expect(names).not.toContain("wartortle");
    expect(names).not.toContain("blastoise");
  });
});
