// src/transport/ui/routes-write.test.ts
//
// Verifies that routes-write.ts passes agent_id via ctx.principal
// rather than in the input object (v0.4 calling convention).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

import * as taskModule from "../../tools/task.js";
import * as channelModule from "../../tools/channel.js";

describe("POST /api/tasks/:id/claim — v0.4 principal calling convention", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let claimHandlerSpy: any;

  beforeEach(() => {
    claimHandlerSpy = vi.spyOn(taskModule.taskTool, "handler").mockResolvedValue({
      task_id: "task-abc",
      claimed_by: "agent:worker",
      claimed_at: "2026-05-21T00:00:00.000Z",
      updated: "2026-05-21T00:00:00.000Z",
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does NOT pass agent_id in the tool input object", async () => {
    const { mountWriteRoutes } = await import("./routes-write.js");
    const app = new Hono();
    mountWriteRoutes(app, { vaultPath: "/fake/vault", fetcher: fetch });

    await app.request("/api/tasks/task-abc/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: "agent:worker",
        expected_updated: "2026-05-21T00:00:00.000Z",
      }),
    });

    expect(claimHandlerSpy).toHaveBeenCalledOnce();
    const [inputArg] = claimHandlerSpy.mock.calls[0];
    expect(inputArg).not.toHaveProperty("agent_id");
  });

  it("passes agent_id via ctx.principal.agent_id to taskClaimTool", async () => {
    const { mountWriteRoutes } = await import("./routes-write.js");
    const app = new Hono();
    mountWriteRoutes(app, { vaultPath: "/fake/vault", fetcher: fetch });

    await app.request("/api/tasks/task-abc/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: "agent:worker",
        expected_updated: "2026-05-21T00:00:00.000Z",
      }),
    });

    expect(claimHandlerSpy).toHaveBeenCalledOnce();
    const [, ctxArg] = claimHandlerSpy.mock.calls[0];
    expect(ctxArg).toHaveProperty("principal");
    expect((ctxArg as any).principal).toEqual({ agent_id: "agent:worker" });
  });
});

describe("POST /api/channels/:name/posts — v0.4 principal calling convention", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let postHandlerSpy: any;

  beforeEach(() => {
    postHandlerSpy = vi.spyOn(channelModule.channelTool, "handler").mockResolvedValue({
      id: "journal-2026-05-21-0000-ops-1",
      channel: "ops",
      created: "2026-05-21T00:00:00.000Z",
      path: "/fake/vault/wikis/stoa/journal/journal-2026-05-21-0000-ops-1.md",
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does NOT pass agent_id in the channelPost tool input object", async () => {
    const { mountWriteRoutes } = await import("./routes-write.js");
    const app = new Hono();
    mountWriteRoutes(app, { vaultPath: "/fake/vault", fetcher: fetch });

    await app.request("/api/channels/ops/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hello world" }),
    });

    expect(postHandlerSpy).toHaveBeenCalledOnce();
    const [inputArg] = postHandlerSpy.mock.calls[0];
    expect(inputArg).not.toHaveProperty("agent_id");
  });

  it("passes human:dashboard as ctx.principal.agent_id to channelPostTool", async () => {
    const { mountWriteRoutes } = await import("./routes-write.js");
    const app = new Hono();
    mountWriteRoutes(app, { vaultPath: "/fake/vault", fetcher: fetch });

    await app.request("/api/channels/ops/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hello world" }),
    });

    expect(postHandlerSpy).toHaveBeenCalledOnce();
    const [, ctxArg] = postHandlerSpy.mock.calls[0];
    expect(ctxArg).toHaveProperty("principal");
    expect((ctxArg as any).principal).toEqual({ agent_id: "human:dashboard" });
  });
});
