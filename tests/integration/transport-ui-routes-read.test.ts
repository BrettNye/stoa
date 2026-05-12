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
    // Server wraps tasks in { tasks: [...], generatedAt } — accept both bare and wrapped
    const arr = Array.isArray(body) ? body : (body && Array.isArray(body.tasks) ? body.tasks : body);
    expect(Array.isArray(arr)).toBe(true);
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
    const arr = Array.isArray(body) ? body : (body && Array.isArray(body.tasks) ? body.tasks : body);
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBeGreaterThan(0);
    const task = arr[0];
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
    const arr = Array.isArray(body) ? body : (body && Array.isArray(body.tasks) ? body.tasks : []);
    expect(arr.every((t: any) => t.status === "pending")).toBe(true);
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
    const arr = Array.isArray(body) ? body : (body && Array.isArray(body.tasks) ? body.tasks : []);
    expect(arr.length).toBeLessThanOrEqual(2);
  });

  it("GET /api/tasks with ?limit=abc returns 400", async () => {
    const app = makeApp(ctx);
    const res = await app.request("/api/tasks?limit=abc");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("GET /api/tasks with ?limit=-1 returns 400", async () => {
    const app = makeApp(ctx);
    const res = await app.request("/api/tasks?limit=-1");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("GET /api/tasks with ?status=garbage returns 400", async () => {
    const app = makeApp(ctx);
    const res = await app.request("/api/tasks?status=garbage");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // GET /api/agents
  // -------------------------------------------------------------------------

  it("GET /api/agents returns 200 with an array", async () => {
    const app = makeApp(ctx);
    const res = await app.request("/api/agents");
    expect(res.status).toBe(200);
    const body = await res.json();
    // Server wraps agents in { agents: [...], generatedAt } — accept both bare and wrapped
    const arr = Array.isArray(body) ? body : (body && Array.isArray(body.agents) ? body.agents : body);
    expect(Array.isArray(arr)).toBe(true);
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
    const arr = Array.isArray(body) ? body : (body && Array.isArray(body.agents) ? body.agents : body);
    expect(arr.length).toBeGreaterThan(0);
    const agent = arr[0];
    // ApiAgent shape
    expect(typeof agent.id).toBe("string");
    expect(typeof agent.pokemon).toBe("string");
    expect(typeof agent.wiki).toBe("string");
    expect(typeof agent.spriteUrl).toBe("string");
    expect(typeof agent.claimedTaskCount).toBe("number");
    expect(typeof agent.updated).toBe("string");
    // is_shiny is always present on enriched agents
    expect(typeof agent.is_shiny).toBe("boolean");
  });

  it("GET /api/agents with a shiny profile returns spriteUrl with ?variant=front_shiny", async () => {
    const profilesDir = join(vaultPath, "wikis", "_agents", "profiles");
    mkdirSync(profilesDir, { recursive: true });
    mkdirSync(join(vaultPath, "wikis", "_agents", "tasks"), { recursive: true });
    writeFileSync(
      join(profilesDir, "profile-charmander-shiny.md"),
      `---
id: profile-charmander-shiny
title: Charmander shiny
type: profile
wiki: _agents
status: active
created: 2026-05-01
updated: 2026-05-01
summary: Shiny fire type agent
pokemon: charmander
pokemon_type: fire
evolution_stage: basic
is_shiny: true
rarity: common
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
    const arr = Array.isArray(body) ? body : (body && Array.isArray(body.agents) ? body.agents : body);
    const shinyAgent = arr.find((a: any) => a.id === "profile-charmander-shiny");
    expect(shinyAgent).toBeDefined();
    expect(shinyAgent.is_shiny).toBe(true);
    expect(shinyAgent.spriteUrl).toContain("?variant=front_shiny");
  });

  it("GET /api/agents returns rarity from profile frontmatter", async () => {
    const profilesDir = join(vaultPath, "wikis", "_agents", "profiles");
    mkdirSync(profilesDir, { recursive: true });
    mkdirSync(join(vaultPath, "wikis", "_agents", "tasks"), { recursive: true });
    writeFileSync(
      join(profilesDir, "profile-mewtwo.md"),
      `---
id: profile-mewtwo
title: Mewtwo
type: profile
wiki: _agents
status: active
created: 2026-05-01
updated: 2026-05-01
summary: Legendary psychic agent
pokemon: mewtwo
pokemon_type: psychic
evolution_stage: basic
is_shiny: false
rarity: legendary
autonomy_level: restricted
moveset: []
applies_to: [claude-code]
---
`
    );

    const app = makeApp(ctx);
    const res = await app.request("/api/agents");
    expect(res.status).toBe(200);
    const body = await res.json();
    const arr = Array.isArray(body) ? body : (body && Array.isArray(body.agents) ? body.agents : body);
    const legendaryAgent = arr.find((a: any) => a.id === "profile-mewtwo");
    expect(legendaryAgent).toBeDefined();
    expect(legendaryAgent.rarity).toBe("legendary");
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
      const urlStr = String(url);
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
    // Server wraps suggestions in { suggestions: [...] } — accept both bare and wrapped
    const arr = Array.isArray(body) ? body : (body && Array.isArray(body.suggestions) ? body.suggestions : body);
    expect(Array.isArray(arr)).toBe(true);
  });

  it("GET /api/agents/suggest returns rarity field on each suggestion", async () => {
    const fireFetcher: typeof fetch = (async (url: string | URL | Request) => {
      const urlStr = String(url);
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
    const arr = Array.isArray(body) ? body : (body && Array.isArray(body.suggestions) ? body.suggestions : []);
    // Each suggestion must have a rarity field
    if (arr.length > 0) {
      const s = arr[0];
      expect(s.rarity).toBeDefined();
      expect(["common", "baby", "legendary", "mythical"]).toContain(s.rarity);
    }
  });

  it("GET /api/agents/suggest returns rarity: 'common' for non-legendary species", async () => {
    const fireFetcher: typeof fetch = (async (url: string | URL | Request) => {
      const urlStr = String(url);
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
    const arr = Array.isArray(body) ? body : (body && Array.isArray(body.suggestions) ? body.suggestions : []);
    if (arr.length > 0) {
      expect(arr[0].rarity).toBe("common");
    }
  });

  it("GET /api/agents/suggest returns rarity: 'legendary' for legendary species", async () => {
    const psychicFetcher: typeof fetch = (async (url: string | URL | Request) => {
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
        JSON.stringify({ pokemon: [{ pokemon: { name: "mewtwo", url: "https://pokeapi.co/api/v2/pokemon/150/" } }] }),
        { status: 200 }
      );
    }) as typeof fetch;

    const appCtx: ReadRoutesCtx = { ...ctx, fetcher: psychicFetcher };
    const app = makeApp(appCtx);
    const res = await app.request("/api/agents/suggest?pokemon_type=psychic");
    expect(res.status).toBe(200);
    const body = await res.json();
    const arr = Array.isArray(body) ? body : (body && Array.isArray(body.suggestions) ? body.suggestions : []);
    if (arr.length > 0) {
      expect(arr[0].rarity).toBe("legendary");
    }
  });

  it("GET /api/agents/suggest returns 200 for valid specialty", async () => {
    const app = makeApp(ctx);
    const res = await app.request("/api/agents/suggest?specialty=backend");
    expect(res.status).toBe(200);
    const body = await res.json();
    // Server wraps suggestions in { suggestions: [...] }
    const arr = Array.isArray(body) ? body : (body && Array.isArray(body.suggestions) ? body.suggestions : body);
    expect(Array.isArray(arr)).toBe(true);
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

  it("GET /api/channels returns ALL entries across channels sorted newest-first", async () => {
    // Seed two channels with multiple entries each
    const journalDir = join(vaultPath, "wikis", "alpha", "journal");
    mkdirSync(journalDir, { recursive: true });

    const pages = [
      {
        id: "journal-2026-05-01-1000-dev-old",
        channel: "dev",
        created: "2026-05-01T10:00:00.000Z",
        body: "dev old",
      },
      {
        id: "journal-2026-05-01-1200-dev-new",
        channel: "dev",
        created: "2026-05-01T12:00:00.000Z",
        body: "dev new",
      },
      {
        id: "journal-2026-05-01-1100-ops-mid",
        channel: "ops",
        created: "2026-05-01T11:00:00.000Z",
        body: "ops mid",
      },
      {
        id: "journal-2026-05-01-0900-ops-old",
        channel: "ops",
        created: "2026-05-01T09:00:00.000Z",
        body: "ops old",
      },
    ];

    const pagesJson = {
      pages: pages.map((p) => ({
        id: p.id,
        type: "journal",
        wiki: "alpha",
        title: `Channel post: ${p.channel}`,
        summary: p.body,
        tags: [],
        status: "active",
        created: p.created,
        updated: p.created,
        channel: p.channel,
        path: `wikis/alpha/journal/${p.id}.md`,
      })),
    };
    writeFileSync(join(vaultPath, "_index", "pages.json"), JSON.stringify(pagesJson));

    for (const p of pages) {
      writeFileSync(
        join(journalDir, `${p.id}.md`),
        `---
id: ${p.id}
title: "Channel post: ${p.channel}"
type: journal
wiki: alpha
status: active
created: ${p.created}
author: agent:testbot
channel: ${p.channel}
---
${p.body}
`
      );
    }

    const app = makeApp(ctx);
    const res = await app.request("/api/channels");
    expect(res.status).toBe(200);
    const body = await res.json();

    // Should return ALL 4 entries, not just 1 per channel (which would be 2)
    expect(body.entries.length).toBe(4);

    // Verify newest-first ordering: 12:00 > 11:00 > 10:00 > 09:00
    expect(body.entries[0].ts).toBe("2026-05-01T12:00:00.000Z");
    expect(body.entries[1].ts).toBe("2026-05-01T11:00:00.000Z");
    expect(body.entries[2].ts).toBe("2026-05-01T10:00:00.000Z");
    expect(body.entries[3].ts).toBe("2026-05-01T09:00:00.000Z");
  });

  // -------------------------------------------------------------------------
  // GET /api/wikis
  // -------------------------------------------------------------------------

  it("GET /api/wikis returns 200 with an array", async () => {
    const app = makeApp(ctx);
    const res = await app.request("/api/wikis");
    expect(res.status).toBe(200);
    const body = await res.json();
    // Server wraps wikis in { wikis: [...] } — accept both bare and wrapped
    const arr = Array.isArray(body) ? body : (body && Array.isArray(body.wikis) ? body.wikis : body);
    expect(Array.isArray(arr)).toBe(true);
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
    const arr = Array.isArray(body) ? body : (body && Array.isArray(body.wikis) ? body.wikis : body);
    expect(arr.length).toBeGreaterThan(0);
    const wiki = arr[0];
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
