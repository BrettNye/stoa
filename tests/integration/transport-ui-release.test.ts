// stoa/tests/integration/transport-ui-release.test.ts
//
// Integration tests for POST /api/tasks/:id/release endpoint in mountWriteRoutes.
// Covers:
//   (a) 400 on missing/malformed body
//   (b) 409 on a non-claimed task (NotClaimedError) with current_status populated
//   (c) 412 on stale expected_updated (ConflictError / OCC mismatch) with current_updated
//   (d) 200 on success with ReleaseResponse shape

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
  const vaultPath = mkdtempSync(join(tmpdir(), "vault-routes-release-"));
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

function makeApp(ctx: WriteRoutesCtx): Hono {
  const app = new Hono();
  mountWriteRoutes(app, ctx);
  return app;
}

function postJson(
  app: Hono,
  url: string,
  body: unknown,
  origin = "http://localhost:3000"
): Promise<Response> {
  return app.request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
    },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("POST /api/tasks/:id/release", () => {
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
  // (a) 400 — body validation failures
  // -------------------------------------------------------------------------

  it("returns 400 when body is empty object", async () => {
    const app = makeApp(ctx);
    const res = await postJson(app, "/api/tasks/task-foo/release", {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(typeof body.error).toBe("string");
  });

  it("returns 400 when expected_updated is missing", async () => {
    const app = makeApp(ctx);
    const res = await postJson(app, "/api/tasks/task-foo/release", {
      wiki: "alpha",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("returns 400 when wiki field is missing", async () => {
    const app = makeApp(ctx);
    const res = await postJson(app, "/api/tasks/task-foo/release", {
      expected_updated: "2026-05-01",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  // -------------------------------------------------------------------------
  // (b) 409 — NotClaimedError: task is not in a claimed/in_progress state
  // -------------------------------------------------------------------------

  it("returns 409 with error:NotClaimed and current_status when task is pending", async () => {
    const wiki = "alpha";
    const id = "task-release-pending";
    // Task is pending (not claimed), so releasing it should fail with NotClaimedError
    writeTaskFile(vaultPath, wiki, id, { status: "pending", updated: "2026-05-01" });
    const app = makeApp(ctx);

    const res = await postJson(app, `/api/tasks/${id}/release`, {
      expected_updated: "2026-05-01",
      wiki,
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("NotClaimed");
    expect(typeof body.current_status).toBe("string");
    expect(body.current_status).toBe("pending");
  });

  it("returns 409 with current_status when task is completed", async () => {
    const wiki = "alpha";
    const id = "task-release-completed";
    writeTaskFile(vaultPath, wiki, id, { status: "completed", updated: "2026-05-01" });
    const app = makeApp(ctx);

    const res = await postJson(app, `/api/tasks/${id}/release`, {
      expected_updated: "2026-05-01",
      wiki,
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("NotClaimed");
    expect(body.current_status).toBe("completed");
  });

  // -------------------------------------------------------------------------
  // (c) 412 — ConflictError: stale expected_updated (OCC mismatch)
  // -------------------------------------------------------------------------

  it("returns 412 with error:OccMismatch and current_updated when expected_updated is stale", async () => {
    const wiki = "alpha";
    const id = "task-release-occ";
    // Task is claimed so it would pass the NotClaimedError check, but actual updated differs
    writeTaskFile(vaultPath, wiki, id, {
      status: "claimed",
      claimed_by: "agent:charmander",
      updated: "2026-05-02",
    });
    const app = makeApp(ctx);

    const res = await postJson(app, `/api/tasks/${id}/release`, {
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
  // (d) 200 — success
  // -------------------------------------------------------------------------

  it("returns 200 with ok:true and task shape on successful release of claimed task", async () => {
    const wiki = "alpha";
    const id = "task-release-success";
    writeTaskFile(vaultPath, wiki, id, {
      status: "claimed",
      claimed_by: "agent:charmander",
      updated: "2026-05-01",
    });
    const app = makeApp(ctx);

    const res = await postJson(app, `/api/tasks/${id}/release`, {
      expected_updated: "2026-05-01",
      wiki,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.task).toBeDefined();
    expect(body.task.id).toBe(id);
    expect(body.task.status).toBe("pending");
    expect(typeof body.task.updated).toBe("string");
  });

  it("returns 200 and task.status is pending after releasing an in_progress task", async () => {
    const wiki = "alpha";
    const id = "task-release-in-progress";
    writeTaskFile(vaultPath, wiki, id, {
      status: "in_progress",
      claimed_by: "agent:bulbasaur",
      updated: "2026-05-01",
    });
    const app = makeApp(ctx);

    const res = await postJson(app, `/api/tasks/${id}/release`, {
      expected_updated: "2026-05-01",
      wiki,
      reason: "Agent stuck",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.task.status).toBe("pending");
  });

  // -------------------------------------------------------------------------
  // Existing routes are not broken
  // -------------------------------------------------------------------------

  it("existing /api/tasks/:id/claim route still works after adding release route", async () => {
    const wiki = "alpha";
    const id = "task-still-claimable";
    writeTaskFile(vaultPath, wiki, id, { updated: "2026-05-01" });
    const app = makeApp(ctx);

    const res = await postJson(app, `/api/tasks/${id}/claim`, {
      agent_id: "charmander",
      expected_updated: "2026-05-01",
      wiki,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.task.status).toBe("claimed");
  });
});
