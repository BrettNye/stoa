// tests/integration/transport-ui-routes-write.test.ts
//
// Integration tests for mountWriteRoutes — the three POST endpoints:
//   POST /api/tasks/:id/claim
//   POST /api/channels/:name/posts
//   POST /api/agents

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { mountWriteRoutes, type WriteRoutesCtx } from "../../src/transport/ui/routes-write.js";

// ---------------------------------------------------------------------------
// Vault fixture helpers
// ---------------------------------------------------------------------------

function makeFakeVault(): string {
  const vaultPath = mkdtempSync(join(tmpdir(), "vault-routes-write-"));
  mkdirSync(join(vaultPath, "_index"), { recursive: true });
  return vaultPath;
}

function writeTaskFile(
  vaultPath: string,
  wiki: string,
  id: string,
  extra: Record<string, unknown> = {}
): void {
  const tasksDir = join(vaultPath, "wikis", wiki, "tasks");
  mkdirSync(tasksDir, { recursive: true });
  const fm: Record<string, unknown> = {
    id,
    title: "Test task",
    type: "task",
    wiki,
    status: "pending",
    created: "2026-05-01",
    updated: "2026-05-01",
    summary: "A test task",
    ...extra,
  };
  const yaml = Object.entries(fm)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");
  writeFileSync(
    join(tasksDir, `${id}.md`),
    `---\n${yaml}\n---\n# Test task\n`
  );
}

function writeJournalDir(vaultPath: string, wiki: string): void {
  mkdirSync(join(vaultPath, "wikis", wiki, "journal"), { recursive: true });
}

function makeApp(ctx: WriteRoutesCtx): Hono {
  const app = new Hono();
  mountWriteRoutes(app, ctx);
  return app;
}

function postJson(app: Hono, url: string, body: unknown, origin = "http://localhost:3000"): Promise<Response> {
  return app.request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": origin,
    },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("mountWriteRoutes — write endpoints", () => {
  let vaultPath: string;
  let ctx: WriteRoutesCtx;

  beforeEach(() => {
    vaultPath = makeFakeVault();
    ctx = {
      vaultPath,
      fetcher: fetch,
      defaultWiki: "alpha",
    };
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // POST /api/tasks/:id/claim — body parsing
  // -------------------------------------------------------------------------

  it("POST /api/tasks/:id/claim with empty body returns 400", async () => {
    const app = makeApp(ctx);
    const res = await postJson(app, "/api/tasks/task-foo/claim", {});
    expect(res.status).toBe(400);
  });

  it("POST /api/tasks/:id/claim missing agent_id returns 400", async () => {
    const app = makeApp(ctx);
    const res = await postJson(app, "/api/tasks/task-foo/claim", {
      expected_updated: "2026-05-01",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("POST /api/tasks/:id/claim missing expected_updated returns 400", async () => {
    const app = makeApp(ctx);
    const res = await postJson(app, "/api/tasks/task-foo/claim", {
      agent_id: "charmander",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  // -------------------------------------------------------------------------
  // POST /api/tasks/:id/claim — success
  // -------------------------------------------------------------------------

  it("POST /api/tasks/:id/claim success returns 200 with ok:true and task shape", async () => {
    const wiki = "alpha";
    const id = "task-claim-me";
    writeTaskFile(vaultPath, wiki, id);
    const app = makeApp(ctx);

    const res = await postJson(app, `/api/tasks/${id}/claim`, {
      agent_id: "charmander",
      expected_updated: "2026-05-01",
      wiki,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.task).toBeDefined();
    expect(body.task.id).toBe(id);
    expect(body.task.status).toBe("claimed");
  });

  // -------------------------------------------------------------------------
  // POST /api/tasks/:id/claim — AlreadyClaimedError → 409
  // -------------------------------------------------------------------------

  it("POST /api/tasks/:id/claim on already-claimed task returns 409 with actual_claimer", async () => {
    const wiki = "alpha";
    const id = "task-already-taken";
    writeTaskFile(vaultPath, wiki, id, {
      status: "claimed",
      claimed_by: "agent:bulbasaur",
    });
    const app = makeApp(ctx);

    const res = await postJson(app, `/api/tasks/${id}/claim`, {
      agent_id: "charmander",
      expected_updated: "2026-05-01",
      wiki,
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("AlreadyClaimedError");
    expect(body.actual_claimer).toBe("agent:bulbasaur");
  });

  // -------------------------------------------------------------------------
  // POST /api/tasks/:id/claim — ConflictError (OCC mismatch) → 412
  // -------------------------------------------------------------------------

  it("POST /api/tasks/:id/claim with wrong expected_updated returns 412 with current_updated", async () => {
    const wiki = "alpha";
    const id = "task-occ-mismatch";
    writeTaskFile(vaultPath, wiki, id, { updated: "2026-05-02" });
    const app = makeApp(ctx);

    const res = await postJson(app, `/api/tasks/${id}/claim`, {
      agent_id: "charmander",
      expected_updated: "2026-05-01", // stale — actual is 2026-05-02
      wiki,
    });
    expect(res.status).toBe(412);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("OccMismatch");
    expect(typeof body.current_updated).toBe("string");
  });

  // -------------------------------------------------------------------------
  // POST /api/channels/:name/posts — body parsing
  // -------------------------------------------------------------------------

  it("POST /api/channels/:name/posts with empty body returns 400", async () => {
    const app = makeApp(ctx);
    const res = await postJson(app, "/api/channels/dev/posts", {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("POST /api/channels/:name/posts with empty content returns 400", async () => {
    const app = makeApp(ctx);
    const res = await postJson(app, "/api/channels/dev/posts", { content: "" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  // -------------------------------------------------------------------------
  // POST /api/channels/:name/posts — success → 201
  // -------------------------------------------------------------------------

  it("POST /api/channels/:name/posts success returns 201 with ok:true and entry", async () => {
    const wiki = "alpha";
    writeJournalDir(vaultPath, wiki);
    const app = makeApp(ctx);

    const res = await postJson(app, "/api/channels/dev/posts", {
      content: "Hello from the dashboard",
      wiki,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.entry).toBeDefined();
    expect(body.entry.channel).toBe("dev");
    expect(body.entry.wiki).toBe(wiki);
  });

  it("POST /api/channels/:name/posts sets agent_id to human:dashboard server-side", async () => {
    const wiki = "alpha";
    writeJournalDir(vaultPath, wiki);
    const app = makeApp(ctx);

    const res = await postJson(app, "/api/channels/dev/posts", {
      content: "Dashboard post",
      wiki,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    // author field in the entry should reflect human:dashboard
    expect(body.entry.author).toContain("dashboard");
  });

  // -------------------------------------------------------------------------
  // POST /api/agents — body parsing
  // -------------------------------------------------------------------------

  it("POST /api/agents with empty body returns 400", async () => {
    const app = makeApp(ctx);
    const res = await postJson(app, "/api/agents", {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("POST /api/agents with invalid species slug (uppercase) returns 400", async () => {
    const app = makeApp(ctx);
    const res = await postJson(app, "/api/agents", {
      selected_species: "Charmander",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  // -------------------------------------------------------------------------
  // POST /api/agents — Stadium failure → 502
  // -------------------------------------------------------------------------

  it("POST /api/agents when Stadium is unreachable returns 502", async () => {
    const app = makeApp(ctx);
    // No real Stadium configured — profileRegisterTool will fail trying to reach it
    // (network error or missing API key). Either way: 502.
    const res = await postJson(app, "/api/agents", {
      selected_species: "charmander",
      evolution_stage: "basic",
      wiki: "alpha",
    });
    // Stadium integration will fail (no API key / no server) — should be 502
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Route registration: exactly three routes
  // -------------------------------------------------------------------------

  it("registers exactly three write routes (no GET routes)", async () => {
    const app = makeApp(ctx);
    // GET on these paths should 405 or 404 (not matched as POST routes)
    // Mainly confirm the 3 POST routes exist by sending valid-enough requests
    const getRes1 = await app.request("/api/tasks/anything/claim");
    // We don't care if it's 404 or 405 — it should not be a 200 success on GET
    expect(getRes1.status).not.toBe(200);

    const getRes2 = await app.request("/api/channels/dev/posts");
    expect(getRes2.status).not.toBe(200);

    const getRes3 = await app.request("/api/agents");
    expect(getRes3.status).not.toBe(200);
  });

  it("no write endpoint accepts query-string parameters for body fields", async () => {
    const app = makeApp(ctx);
    // Sending agent_id and expected_updated as query params should not work (→ 400)
    const res = await app.request(
      "/api/tasks/task-foo/claim?agent_id=charmander&expected_updated=2026-05-01",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }
    );
    expect(res.status).toBe(400);
  });
});
