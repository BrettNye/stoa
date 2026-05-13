import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { mountReadRoutes } from "../../src/transport/ui/routes-read.js";
import type { ReadRoutesCtx } from "../../src/transport/ui/routes-read.js";
import type { ApiAgent } from "../../src/transport/ui/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeVault(): string {
  const vaultPath = mkdtempSync(join(tmpdir(), "vault-agents-system-"));
  mkdirSync(join(vaultPath, "_index"), { recursive: true });
  mkdirSync(join(vaultPath, "wikis", "_agents", "profiles"), { recursive: true });
  mkdirSync(join(vaultPath, "wikis", "_agents", "tasks"), { recursive: true });
  return vaultPath;
}

function writeRawProfile(vaultPath: string, id: string, frontmatterLines: string[]): void {
  const content = ["---", ...frontmatterLines, "---"].join("\n");
  writeFileSync(join(vaultPath, "wikis", "_agents", "profiles", `${id}.md`), content, "utf8");
}

const noopFetcher: typeof fetch = (async (_url: string | URL | Request) => {
  return new Response(JSON.stringify({ pokemon: [] }), { status: 200 });
}) as typeof fetch;

function makeApp(ctx: ReadRoutesCtx): Hono {
  const app = new Hono();
  mountReadRoutes(app, ctx);
  return app;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("GET /api/agents — summary and system fields", () => {
  let vaultPath: string;
  let ctx: ReadRoutesCtx;

  beforeEach(() => {
    vaultPath = makeFakeVault();
    ctx = {
      vaultPath,
      fetcher: noopFetcher,
      startedAt: new Date().toISOString(),
    };
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("response includes summary field for a profile with a non-empty summary", async () => {
    writeRawProfile(vaultPath, "profile-squirtle", [
      "id: profile-squirtle",
      "title: Squirtle",
      "type: profile",
      "wiki: _agents",
      "pokemon_type: water",
      "evolution_stage: basic",
      "moveset: []",
      `summary: "Water specialist"`,
      "created: 2026-01-01",
      "updated: 2026-01-01",
      "status: active",
    ]);

    const app = makeApp(ctx);
    const res = await app.request("/api/agents");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toBeDefined();
    expect(body.agents.length).toBe(1);

    const agent: ApiAgent = body.agents[0];
    expect(agent.summary).toBe("Water specialist");
  });

  it("response has no summary field (or undefined) for a profile without summary", async () => {
    writeRawProfile(vaultPath, "profile-squirtle", [
      "id: profile-squirtle",
      "title: Squirtle",
      "type: profile",
      "wiki: _agents",
      "pokemon_type: water",
      "evolution_stage: basic",
      "moveset: []",
      "created: 2026-01-01",
      "updated: 2026-01-01",
      "status: active",
    ]);

    const app = makeApp(ctx);
    const res = await app.request("/api/agents");
    const body = await res.json();
    const agent: ApiAgent = body.agents[0];
    // Should be undefined or absent — no value
    expect(agent.summary == null).toBe(true);
  });

  it("response includes system: true for a profile with system: true in frontmatter", async () => {
    writeRawProfile(vaultPath, "profile-mewtwo", [
      "id: profile-mewtwo",
      "title: Mewtwo",
      "type: profile",
      "wiki: _agents",
      "pokemon_type: psychic",
      "evolution_stage: stage2",
      "moveset: []",
      `summary: "Merge orchestrator"`,
      "system: true",
      "created: 2026-01-01",
      "updated: 2026-01-01",
      "status: active",
    ]);

    const app = makeApp(ctx);
    const res = await app.request("/api/agents");
    expect(res.status).toBe(200);
    const body = await res.json();
    const agent: ApiAgent = body.agents[0];
    expect(agent.system).toBe(true);
  });

  it("system field is absent or undefined for non-system profiles", async () => {
    writeRawProfile(vaultPath, "profile-squirtle", [
      "id: profile-squirtle",
      "title: Squirtle",
      "type: profile",
      "wiki: _agents",
      "pokemon_type: water",
      "evolution_stage: basic",
      "moveset: []",
      `summary: "Frontend flows"`,
      "created: 2026-01-01",
      "updated: 2026-01-01",
      "status: active",
    ]);

    const app = makeApp(ctx);
    const res = await app.request("/api/agents");
    const body = await res.json();
    const agent: ApiAgent = body.agents[0];
    expect(agent.system == null).toBe(true);
  });

  it("returns both summary and system correctly for multiple mixed profiles", async () => {
    writeRawProfile(vaultPath, "profile-squirtle", [
      "id: profile-squirtle",
      "title: Squirtle",
      "type: profile",
      "wiki: _agents",
      "pokemon_type: water",
      "evolution_stage: basic",
      "moveset: []",
      `summary: "Frontend flows"`,
      "created: 2026-01-01",
      "updated: 2026-01-01",
      "status: active",
    ]);
    writeRawProfile(vaultPath, "profile-mewtwo", [
      "id: profile-mewtwo",
      "title: Mewtwo",
      "type: profile",
      "wiki: _agents",
      "pokemon_type: psychic",
      "evolution_stage: stage2",
      "moveset: []",
      `summary: "Merge orchestrator"`,
      "system: true",
      "created: 2026-01-01",
      "updated: 2026-01-01",
      "status: active",
    ]);

    const app = makeApp(ctx);
    const res = await app.request("/api/agents");
    const body = await res.json();
    expect(body.agents.length).toBe(2);

    const squirtle: ApiAgent = body.agents.find((a: ApiAgent) => a.id === "profile-squirtle")!;
    const mewtwo: ApiAgent = body.agents.find((a: ApiAgent) => a.id === "profile-mewtwo")!;

    expect(squirtle.summary).toBe("Frontend flows");
    expect(squirtle.system == null).toBe(true);

    expect(mewtwo.summary).toBe("Merge orchestrator");
    expect(mewtwo.system).toBe(true);
  });

  // -------------------------------------------------------------------------
  // ApiAgent type shape
  // -------------------------------------------------------------------------

  it("ApiAgent interface supports summary? and system? fields (compile-time shape check)", () => {
    const agent: ApiAgent = {
      id: "profile-mewtwo",
      wiki: "_agents",
      pokemon: "mewtwo",
      evolution_stage: "stage2",
      spriteUrl: "/api/sprites/mewtwo.svg",
      updated: "2026-01-01T00:00:00.000Z",
      claimedTaskCount: 0,
      summary: "Merge orchestrator",
      system: true,
    };
    expect(agent.summary).toBe("Merge orchestrator");
    expect(agent.system).toBe(true);

    // Optional: no error when omitted
    const agentNoOpts: ApiAgent = {
      id: "profile-squirtle",
      wiki: "_agents",
      pokemon: "squirtle",
      evolution_stage: "basic",
      spriteUrl: "/api/sprites/squirtle.svg",
      updated: "2026-01-01T00:00:00.000Z",
      claimedTaskCount: 0,
    };
    expect(agentNoOpts.summary).toBeUndefined();
    expect(agentNoOpts.system).toBeUndefined();
  });
});
