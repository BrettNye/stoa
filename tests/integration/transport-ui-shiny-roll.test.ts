// tests/integration/transport-ui-shiny-roll.test.ts
//
// Integration tests for the shiny roll mechanic in POST /api/agents.
//
// Tests:
// 1. Shiny path: when Math.random() returns < 1/64, profile frontmatter gets
//    is_shiny: true, rarity is set, and spriteUrl uses ?variant=front_shiny.
// 2. Non-shiny path: when Math.random() returns >= 1/64, profile frontmatter
//    gets is_shiny: false (or absent), spriteUrl does NOT include variant.
// 3. Response shape includes rarity and is_shiny fields.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { mountWriteRoutes, type WriteRoutesCtx } from "../../src/transport/ui/routes-write.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeVault(): string {
  const vaultPath = mkdtempSync(join(tmpdir(), "vault-shiny-roll-"));
  mkdirSync(join(vaultPath, "_index"), { recursive: true });
  return vaultPath;
}

function makeApp(ctx: WriteRoutesCtx): Hono {
  const app = new Hono();
  mountWriteRoutes(app, ctx);
  return app;
}

function postJson(app: Hono, url: string, body: unknown): Promise<Response> {
  return app.request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// A fetcher that returns a fake PokeAPI species response for any species.
// Returns is_legendary: false, is_mythical: false, is_baby: false (common).
function makeCommonSpeciesFetcher(): typeof fetch {
  return (async (url: string | URL | Request) => {
    const urlStr = String(url);
    // pokemon-species endpoint: return basic common species data
    if (urlStr.includes("pokemon-species")) {
      return new Response(
        JSON.stringify({
          name: "charmander",
          is_legendary: false,
          is_mythical: false,
          is_baby: false,
          evolves_from_species: null,
        }),
        { status: 200 }
      );
    }
    // pokemon endpoint (if called): return minimal data
    return new Response(
      JSON.stringify({
        name: "charmander",
        types: [{ type: { name: "fire" } }],
        sprites: { front_default: null, front_shiny: null },
        species: { url: `https://pokeapi.co/api/v2/pokemon-species/charmander/` },
      }),
      { status: 200 }
    );
  }) as typeof fetch;
}

function makeLegendarySpeciesFetcher(): typeof fetch {
  return (async (url: string | URL | Request) => {
    const urlStr = String(url);
    if (urlStr.includes("pokemon-species")) {
      return new Response(
        JSON.stringify({
          name: "mewtwo",
          is_legendary: true,
          is_mythical: false,
          is_baby: false,
          evolves_from_species: null,
        }),
        { status: 200 }
      );
    }
    return new Response(
      JSON.stringify({
        name: "mewtwo",
        types: [{ type: { name: "psychic" } }],
        sprites: { front_default: null, front_shiny: null },
        species: { url: `https://pokeapi.co/api/v2/pokemon-species/mewtwo/` },
      }),
      { status: 200 }
    );
  }) as typeof fetch;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("POST /api/agents — shiny roll", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = makeFakeVault();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Shiny path
  // -------------------------------------------------------------------------

  it("when Math.random() < 1/64, is_shiny is true in the response and profile frontmatter", async () => {
    // Force shiny roll
    vi.spyOn(Math, "random").mockReturnValue(0); // 0 < 1/64 = true

    const ctx: WriteRoutesCtx = {
      vaultPath,
      fetcher: makeCommonSpeciesFetcher(),
      defaultWiki: "alpha",
    };
    const app = makeApp(ctx);

    const res = await postJson(app, "/api/agents", {
      selected_species: "charmander",
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.agent.is_shiny).toBe(true);
  });

  it("shiny spriteUrl uses ?variant=front_shiny", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // shiny

    const ctx: WriteRoutesCtx = {
      vaultPath,
      fetcher: makeCommonSpeciesFetcher(),
      defaultWiki: "alpha",
    };
    const app = makeApp(ctx);

    const res = await postJson(app, "/api/agents", {
      selected_species: "charmander",
    });
    const body = await res.json();
    expect(body.agent.spriteUrl).toContain("?variant=front_shiny");
  });

  it("shiny profile frontmatter contains is_shiny: true", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // shiny

    const ctx: WriteRoutesCtx = {
      vaultPath,
      fetcher: makeCommonSpeciesFetcher(),
      defaultWiki: "alpha",
    };
    const app = makeApp(ctx);

    await postJson(app, "/api/agents", { selected_species: "charmander" });

    // Find the created profile file
    const profilesDir = join(vaultPath, "wikis", "alpha", "profiles");
    const files = existsSync(profilesDir) ? readdirSync(profilesDir).filter(f => f.endsWith(".md")) : [];
    expect(files.length).toBeGreaterThan(0);

    const content = readFileSync(join(profilesDir, files[0]), "utf8");
    expect(content).toContain("is_shiny: true");
  });

  // -------------------------------------------------------------------------
  // Non-shiny path
  // -------------------------------------------------------------------------

  it("when Math.random() >= 1/64, is_shiny is false in the response", async () => {
    // 1/64 = 0.015625; use a value above that
    vi.spyOn(Math, "random").mockReturnValue(0.1); // 0.1 >= 1/64 → not shiny

    const ctx: WriteRoutesCtx = {
      vaultPath,
      fetcher: makeCommonSpeciesFetcher(),
      defaultWiki: "alpha",
    };
    const app = makeApp(ctx);

    const res = await postJson(app, "/api/agents", {
      selected_species: "charmander",
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.agent.is_shiny).toBe(false);
  });

  it("non-shiny spriteUrl does NOT include variant param", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5); // not shiny

    const ctx: WriteRoutesCtx = {
      vaultPath,
      fetcher: makeCommonSpeciesFetcher(),
      defaultWiki: "alpha",
    };
    const app = makeApp(ctx);

    const res = await postJson(app, "/api/agents", {
      selected_species: "charmander",
    });
    const body = await res.json();
    expect(body.agent.spriteUrl).not.toContain("variant");
    expect(body.agent.spriteUrl).toBe(`/api/sprites/charmander.svg`);
  });

  it("non-shiny profile frontmatter contains is_shiny: false", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5); // not shiny

    const ctx: WriteRoutesCtx = {
      vaultPath,
      fetcher: makeCommonSpeciesFetcher(),
      defaultWiki: "alpha",
    };
    const app = makeApp(ctx);

    await postJson(app, "/api/agents", { selected_species: "charmander" });

    const profilesDir = join(vaultPath, "wikis", "alpha", "profiles");
    const files = existsSync(profilesDir) ? readdirSync(profilesDir).filter(f => f.endsWith(".md")) : [];
    expect(files.length).toBeGreaterThan(0);

    const content = readFileSync(join(profilesDir, files[0]), "utf8");
    expect(content).toContain("is_shiny: false");
  });

  // -------------------------------------------------------------------------
  // Rarity in response
  // -------------------------------------------------------------------------

  it("response includes rarity: 'common' for a non-legendary species", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5); // not shiny

    const ctx: WriteRoutesCtx = {
      vaultPath,
      fetcher: makeCommonSpeciesFetcher(),
      defaultWiki: "alpha",
    };
    const app = makeApp(ctx);

    const res = await postJson(app, "/api/agents", {
      selected_species: "charmander",
    });
    const body = await res.json();
    expect(body.agent.rarity).toBe("common");
  });

  it("response includes rarity: 'legendary' for a legendary species", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5); // not shiny

    const ctx: WriteRoutesCtx = {
      vaultPath,
      fetcher: makeLegendarySpeciesFetcher(),
      defaultWiki: "alpha",
    };
    const app = makeApp(ctx);

    const res = await postJson(app, "/api/agents", {
      selected_species: "mewtwo",
    });
    const body = await res.json();
    expect(body.agent.rarity).toBe("legendary");
  });

  it("rarity is persisted in profile frontmatter", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5); // not shiny

    const ctx: WriteRoutesCtx = {
      vaultPath,
      fetcher: makeLegendarySpeciesFetcher(),
      defaultWiki: "alpha",
    };
    const app = makeApp(ctx);

    await postJson(app, "/api/agents", { selected_species: "mewtwo" });

    const profilesDir = join(vaultPath, "wikis", "alpha", "profiles");
    const files = existsSync(profilesDir) ? readdirSync(profilesDir).filter(f => f.endsWith(".md")) : [];
    expect(files.length).toBeGreaterThan(0);

    const content = readFileSync(join(profilesDir, files[0]), "utf8");
    expect(content).toContain("rarity: legendary");
  });

  // -------------------------------------------------------------------------
  // Exact threshold: Math.random() === 1/64 boundary
  // -------------------------------------------------------------------------

  it("exactly at 1/64 boundary (0.015625) is NOT shiny (< not <=)", async () => {
    vi.spyOn(Math, "random").mockReturnValue(1 / 64); // equals boundary — NOT shiny

    const ctx: WriteRoutesCtx = {
      vaultPath,
      fetcher: makeCommonSpeciesFetcher(),
      defaultWiki: "alpha",
    };
    const app = makeApp(ctx);

    const res = await postJson(app, "/api/agents", {
      selected_species: "charmander",
    });
    const body = await res.json();
    expect(body.agent.is_shiny).toBe(false);
  });

  it("just below 1/64 (0.015) IS shiny", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.015); // 0.015 < 0.015625

    const ctx: WriteRoutesCtx = {
      vaultPath,
      fetcher: makeCommonSpeciesFetcher(),
      defaultWiki: "alpha",
    };
    const app = makeApp(ctx);

    const res = await postJson(app, "/api/agents", {
      selected_species: "charmander",
    });
    const body = await res.json();
    expect(body.agent.is_shiny).toBe(true);
  });
});
