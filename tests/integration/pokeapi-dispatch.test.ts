// Regression test for v1.6 Phase 1 T0-1: the MCP dispatch layer must thread
// a `fetcher` into ctx so PokeAPI-touching tools (vault.evolve-profile proposal
// phase, vault.suggest-pokemon) actually call PokeAPI in production. Before the
// fix, stdio.ts constructed ctx as `{ vaultPath, defaultWiki }` (no fetcher),
// and PokeAPI-touching tools silently fell back to non-PokeAPI behaviour.
//
// Spec: wikis/_meta/specs/2026-04-30-vault-mcp-v1.6-design.md §4.3, §7.4, §9.3.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildCtx } from "../../src/transport/stdio.js";
import { evolveProfileTool } from "../../src/tools/evolve-profile.js";
import { reindex } from "../../src/core/reindex.js";

function seedEvolutionEligibleProfile(vaultPath: string): void {
  const profilesDir = join(vaultPath, "wikis", "_agents", "profiles");
  mkdirSync(profilesDir, { recursive: true });
  const tasksDir = join(vaultPath, "wikis", "alpha", "tasks");
  mkdirSync(tasksDir, { recursive: true });
  mkdirSync(join(vaultPath, "_index"), { recursive: true });

  writeFileSync(join(profilesDir, "profile-charmander.md"),
    `---
id: profile-charmander
title: Charmander
type: profile
wiki: _agents
status: active
created: 2026-01-01
updated: 2026-04-30
summary: Backend
pokemon_type: fire
evolution_stage: basic
autonomy_level: restricted
moveset: [move-tdd-cycle]
applies_to: [claude-code]
---
`);

  // Seed 30 completed tasks at 100% to clear the evolution threshold.
  for (let i = 0; i < 30; i++) {
    writeFileSync(join(tasksDir, `task-fixture-${i}.md`),
      `---
id: task-fixture-${i}
title: fixture task ${i}
type: task
wiki: alpha
status: completed
created: 2026-04-01
updated: 2026-04-01
claimed_by: agent:charmander
---
`);
  }

  reindex(vaultPath);
}

describe("MCP dispatch — fetcher threading (T0-1)", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-pokeapi-disp-"));
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("buildCtx populates ctx.fetcher from globalThis.fetch", () => {
    const ctx = buildCtx({ vaultPath, mcpMode: true });
    expect(typeof ctx.fetcher).toBe("function");
    // Surface the binding contract: ctx.fetcher should be callable as plain fetch.
    // (We don't actually invoke it here — that would hit the network.)
  });

  it("buildCtx forwards vaultPath and defaultWiki unchanged", () => {
    const ctx = buildCtx({ vaultPath, mcpMode: true, defaultWiki: "alpha" });
    expect(ctx.vaultPath).toBe(vaultPath);
    expect(ctx.defaultWiki).toBe("alpha");
  });

  it("buildCtx forwards defaultFamily when set (T3-6)", () => {
    const ctx = buildCtx({ vaultPath, mcpMode: true, defaultFamily: "rastate" });
    expect(ctx.defaultFamily).toBe("rastate");
    // Sanity: defaultWiki and defaultFamily are independent fields
    expect(ctx.defaultWiki).toBeUndefined();
  });

  it("buildCtx leaves ctx.defaultFamily undefined when config omits it", () => {
    const ctx = buildCtx({ vaultPath, mcpMode: true });
    expect(ctx.defaultFamily).toBeUndefined();
  });

  it("buildCtx forwards defaultWiki and defaultFamily together (T3-6)", () => {
    const ctx = buildCtx({
      vaultPath,
      mcpMode: true,
      defaultWiki: "rastate-core",
      defaultFamily: "rastate"
    });
    expect(ctx.defaultWiki).toBe("rastate-core");
    expect(ctx.defaultFamily).toBe("rastate");
  });

  it("vault.evolve-profile proposal phase, dispatched through the production ctx, sets proposed.name from PokeAPI", async () => {
    seedEvolutionEligibleProfile(vaultPath);

    // Mock fetch to simulate a PokeAPI evolution chain. Restore on completion.
    const fetchCalls: string[] = [];
    const charmanderResp = {
      name: "charmander",
      types: [{ type: { name: "fire" } }],
      species: { url: "https://pokeapi.co/api/v2/pokemon-species/4/" },
      sprites: { front_default: null }
    };
    const speciesResp = { evolution_chain: { url: "https://pokeapi.co/api/v2/evolution-chain/2/" } };
    const chainResp = {
      chain: {
        species: { name: "charmander", url: "" },
        evolves_to: [{
          species: { name: "charmeleon", url: "" },
          evolves_to: []
        }]
      }
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      fetchCalls.push(u);
      if (u.includes("/pokemon/charmander")) return new Response(JSON.stringify(charmanderResp), { status: 200 });
      if (u.includes("/pokemon-species/4/")) return new Response(JSON.stringify(speciesResp), { status: 200 });
      if (u.includes("/evolution-chain/2/")) return new Response(JSON.stringify(chainResp), { status: 200 });
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    try {
      // The point of the test: build ctx via the same path stdio.ts uses,
      // then dispatch the tool exactly as the MCP request handler would.
      const ctx = buildCtx({ vaultPath, mcpMode: true });
      const result = await evolveProfileTool.handler(
        { pokemon_id: "profile-charmander", commit: false },
        ctx as any
      );
      expect(result.eligible).toBe(true);
      expect(result.proposed.name).toBe("profile-charmeleon");
      // The fetcher must actually have been hit — confirms threading, not just shape.
      expect(fetchCalls.length).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
