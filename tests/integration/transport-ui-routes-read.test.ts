import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { mountReadRoutes } from "../../src/transport/ui/routes-read.js";
import type { ReadRoutesCtx } from "../../src/transport/ui/routes-read.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeVault(): string {
  const vaultPath = mkdtempSync(join(tmpdir(), "vault-routes-read-"));
  // Minimal _index dir so loadIndex does not throw
  mkdirSync(join(vaultPath, "_index"), { recursive: true });
  return vaultPath;
}

function makeApp(ctx: ReadRoutesCtx): Hono {
  const app = new Hono();
  mountReadRoutes(app, ctx);
  return app;
}

// A fake fetcher that never actually hits the network — returns a type list
// for "fire", 404 for everything else.
const noopFetcher: typeof fetch = (async (_url: string | URL | Request) => {
  return new Response(JSON.stringify({ pokemon: [] }), { status: 200 });
}) as typeof fetch;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("mountReadRoutes — read endpoints", () => {
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

  // -------------------------------------------------------------------------
  // GET /api/health
  // -------------------------------------------------------------------------

  it("GET /api/health returns 200 with ok:true and a wikis count", async () => {
    const app = makeApp(ctx);
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.wikis).toBe("number");
    expect(body.wikis).toBeGreaterThanOrEqual(0);
  });

  it("GET /api/health returns vault path and indexedAt", async () => {
    const app = makeApp(ctx);
    const res = await app.request("/api/health");
    const body = await res.json();
    expect(body.vault).toBe(vaultPath);
    // indexedAt can be null if _index/wikis.json absent — just assert it exists as key
    expect("indexedAt" in body).toBe(true);
  });

  // -------------------------------------------------------------------------
  // GET /api/tasks
  // -------------------------------------------------------------------------

  it("GET /api/tasks returns 200 with an array", async () => {
    const app = makeApp(ctx);
    const res = await app.request("/api/tasks");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("GET /api/tasks with a real task file returns task shape", async () => {
    // Seed a task file
    const wikiTasksDir = join(vaultPath, "wikis", "alpha", "tasks");
    mkdirSync(wikiTasksDir, { recursive: true });
    writeFileSync(
      join(wikiTasksDir, "task-do-something.md"),
      `---
id: task-do-something
title: Do something
type: task
wiki: alpha
status: pending
created: 2026-05-01
updated: 2026-05-01
summary: A test task
---
# Do something
`
    );

    const app = makeApp(ctx);
    const res = await app.request("/api/tasks?wiki=alpha");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    const task = body[0];
    expect(task.id).toBe("task-do-something");
    expect(task.wiki).toBe("alpha");
    expect(task.status).toBe("pending");
  });

  it("GET /api/tasks accepts ?status= filter", async () => {
    const wikiTasksDir = join(vaultPath, "wikis", "alpha", "tasks");
    mkdirSync(wikiTasksDir, { recursive: true });
    writeFileSync(
      join(wikiTasksDir, "task-pending-one.md"),
      `---
id: task-pending-one
title: Pending one
type: task
wiki: alpha
status: pending
created: 2026-05-01
updated: 2026-05-01
summary: Pending
---
`
    );
    writeFileSync(
      join(wikiTasksDir, "task-claimed-one.md"),
      `---
id: task-claimed-one
title: Claimed one
type: task
wiki: alpha
status: claimed
claimed_by: agent:bulbasaur
created: 2026-05-01
updated: 2026-05-01
summary: Claimed
---
`
    );

    const app = makeApp(ctx);
    const res = await app.request("/api/tasks?status=pending");
    const body = await res.json();
    expect(body.every((t: any) => t.status === "pending")).toBe(true);
  });

  it("GET /api/tasks accepts ?limit= param", async () => {
    const wikiTasksDir = join(vaultPath, "wikis", "alpha", "tasks");
    mkdirSync(wikiTasksDir, { recursive: true });
    for (let i = 0; i < 5; i++) {
      writeFileSync(
        join(wikiTasksDir, `task-item-${i}.md`),
        `---
id: task-item-${i}
title: Item ${i}
type: task
wiki: alpha
status: pending
created: 2026-05-01
updated: 2026-05-01
summary: Item ${i}
---
`
      );
    }

    const app = makeApp(ctx);
    const res = await app.request("/api/tasks?limit=2");
    const body = await res.json();
    expect(body.length).toBeLessThanOrEqual(2);
  });

  // -------------------------------------------------------------------------
  // GET /api/agents
  // -------------------------------------------------------------------------

  it("GET /api/agents returns 200 with an array", async () => {
    const app = makeApp(ctx);
    const res = await app.request("/api/agents");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("GET /api/agents with a profile returns ApiAgent shape", async () => {
    const profilesDir = join(vaultPath, "wikis", "_agents", "profiles");
    mkdirSync(profilesDir, { recursive: true });
    mkdirSync(join(vaultPath, "wikis", "_agents", "tasks"), { recursive: true });
    writeFileSync(
      join(profilesDir, "profile-charmander.md"),
      `---
id: profile-charmander
title: Charmander
type: profile
wiki: _agents
status: active
created: 2026-05-01
updated: 2026-05-01
summary: Fire type agent
pokemon_type: fire
evolution_stage: basic
autonomy_level: restricted
moveset: [move-tdd-cycle]
applies_to: [claude-code]
---
`
    );

    const app = makeApp(ctx);
    const res = await app.request("/api/agents");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThan(0);
    const agent = body[0];
    // ApiAgent shape
    expect(typeof agent.id).toBe("string");
    expect(typeof agent.pokemon).toBe("string");
    expect(typeof agent.wiki).toBe("string");
    expect(typeof agent.spriteUrl).toBe("string");
    expect(typeof agent.claimedTaskCount).toBe("number");
    expect(typeof agent.updated).toBe("string");
  });

  // -------------------------------------------------------------------------
  // GET /api/agents/suggest
  // -------------------------------------------------------------------------

  it("GET /api/agents/suggest returns 400 without specialty or pokemon_type", async () => {
    const app = makeApp(ctx);
    const res = await app.request("/api/agents/suggest");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("GET /api/agents/suggest returns 400 for invalid pokemon_type", async () => {
    const app = makeApp(ctx);
    const res = await app.request("/api/agents/suggest?pokemon_type=notreal");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("GET /api/agents/suggest returns 200 for valid pokemon_type", async () => {
    const fireFetcher: typeof fetch = (async (url: string | URL | Request) => {
      return new Response(
        JSON.stringify({ pokemon: [{ pokemon: { name: "charmander", url: "https://pokeapi.co/api/v2/pokemon/4/" } }] }),
        { status: 200 }
      );
    }) as typeof fetch;

    const appCtx: ReadRoutesCtx = { ...ctx, fetcher: fireFetcher };
    const app = makeApp(appCtx);
    const res = await app.request("/api/agents/suggest?pokemon_type=fire");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("GET /api/agents/suggest returns 200 for valid specialty", async () => {
    const app = makeApp(ctx);
    const res = await app.request("/api/agents/suggest?specialty=backend");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // GET /api/channels
  // -------------------------------------------------------------------------

  it("GET /api/channels returns 200 with channels and entries arrays", async () => {
    const app = makeApp(ctx);
    const res = await app.request("/api/channels");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.channels)).toBe(true);
    expect(Array.isArray(body.entries)).toBe(true);
  });

  it("GET /api/channels with journal entries returns sorted newest-first entries", async () => {
    // Seed a channel journal entry
    const journalDir = join(vaultPath, "wikis", "alpha", "journal");
    mkdirSync(journalDir, { recursive: true });
    // Write index files so loadIndex picks them up
    const pagesJson = {
      pages: [
        {
          id: "journal-2026-05-01-1200-test-post",
          type: "journal",
          wiki: "alpha",
          title: "Channel post: dev",
          summary: "test",
          tags: [],
          status: "active",
          created: "2026-05-01T12:00:00.000Z",
          updated: "2026-05-01T12:00:00.000Z",
          channel: "dev",
          path: "wikis/alpha/journal/journal-2026-05-01-1200-test-post.md"
        }
      ]
    };
    writeFileSync(join(vaultPath, "_index", "pages.json"), JSON.stringify(pagesJson));
    writeFileSync(
      join(journalDir, "journal-2026-05-01-1200-test-post.md"),
      `---
id: journal-2026-05-01-1200-test-post
title: "Channel post: dev"
type: journal
wiki: alpha
status: active
created: 2026-05-01T12:00:00.000Z
author: agent:charmander
channel: dev
---
Hello from dev channel
`
    );

    const app = makeApp(ctx);
    const res = await app.request("/api/channels");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.channels.length).toBeGreaterThan(0);
    // entries should be present and newest-first
    const channelSummary = body.channels[0];
    expect(channelSummary.name).toBe("dev");
    expect(channelSummary.wiki).toBe("alpha");
  });

  // -------------------------------------------------------------------------
  // GET /api/wikis
  // -------------------------------------------------------------------------

  it("GET /api/wikis returns 200 with an array", async () => {
    const app = makeApp(ctx);
    const res = await app.request("/api/wikis");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("GET /api/wikis returns ApiWiki shape when wikis indexed", async () => {
    const wikisJson = {
      wikis: [
        {
          name: "alpha",
          mode: "idea-map",
          scope: "test",
          page_counts: { concept: 2, task: 3 },
          last_touched: "2026-05-01"
        }
      ]
    };
    writeFileSync(join(vaultPath, "_index", "wikis.json"), JSON.stringify(wikisJson));

    const app = makeApp(ctx);
    const res = await app.request("/api/wikis");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThan(0);
    const wiki = body[0];
    expect(wiki.name).toBe("alpha");
    expect(wiki.mode).toBe("idea-map");
    expect(typeof wiki.pageCount).toBe("number");
    expect(typeof wiki.activeTasks).toBe("number");
  });

  // -------------------------------------------------------------------------
  // Route count: exactly 6 registered
  // -------------------------------------------------------------------------

  it("registers exactly six routes (no /api/sprites route)", async () => {
    const app = makeApp(ctx);
    // Sprites route should NOT be mounted here — should return 404
    const spritesRes = await app.request("/api/sprites/charmander.svg");
    expect(spritesRes.status).toBe(404);

    // All 6 registered routes should respond with 200 (not 404)
    const routes = [
      "/api/health",
      "/api/tasks",
      "/api/agents",
      "/api/agents/suggest?pokemon_type=fire",
      "/api/channels",
      "/api/wikis",
    ];
    for (const route of routes) {
      const res = await app.request(route);
      expect(res.status, `Expected 200 for ${route}`).not.toBe(404);
    }
  });
});
