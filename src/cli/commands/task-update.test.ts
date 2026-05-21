// src/cli/commands/task-update.test.ts
//
// Verifies that the task-update CLI command passes agent_id via
// ctx.principal.agent_id rather than in the input object (v0.4 calling convention).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

// We'll spy on the taskUpdateTool handler to capture how it's called
import * as taskUpdateModule from "../../tools/task-update.js";
import * as ctxModule from "../_ctx.js";
import * as resolveWikiModule from "../../tools/_resolve-wiki.js";

describe("task-update CLI: v0.4 principal calling convention", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let handlerSpy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let getCtxSpy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let resolveWikiSpy: any;

  beforeEach(() => {
    // Mock handler to avoid real filesystem calls
    handlerSpy = vi.spyOn(taskUpdateModule.taskUpdateTool, "handler").mockResolvedValue({
      task_id: "task-foo",
      updated: "2026-05-21T00:00:00.000Z",
      status: "in_progress",
    } as any);

    // Mock getCtx
    getCtxSpy = vi.spyOn(ctxModule, "getCtx").mockReturnValue({
      vaultPath: "/fake/vault",
      defaultWiki: "stoa",
    } as any);

    // Mock resolveWiki to return predictable wiki
    resolveWikiSpy = vi.spyOn(resolveWikiModule, "resolveWiki").mockReturnValue("stoa");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does NOT pass agent_id in the input object", async () => {
    const { registerTaskUpdate } = await import("./task-update.js");
    const program = new Command();
    registerTaskUpdate(program);
    await program.parseAsync([
      "node", "stoa",
      "task-update", "task-foo",
      "--expected-updated", "2026-05-21T00:00:00.000Z",
      "--status", "in_progress",
      "--agent-id", "agent:worker-1",
    ]);

    expect(handlerSpy).toHaveBeenCalledOnce();
    const [inputArg] = handlerSpy.mock.calls[0];
    expect(inputArg).not.toHaveProperty("agent_id");
  });

  it("passes agent_id via ctx.principal.agent_id", async () => {
    const { registerTaskUpdate } = await import("./task-update.js");
    const program = new Command();
    registerTaskUpdate(program);
    await program.parseAsync([
      "node", "stoa",
      "task-update", "task-foo",
      "--expected-updated", "2026-05-21T00:00:00.000Z",
      "--agent-id", "agent:worker-1",
    ]);

    expect(handlerSpy).toHaveBeenCalledOnce();
    const [, ctxArg] = handlerSpy.mock.calls[0];
    expect(ctxArg).toHaveProperty("principal");
    expect((ctxArg as any).principal).toEqual({ agent_id: "agent:worker-1" });
  });

  it("omits principal when --agent-id flag is not provided", async () => {
    const { registerTaskUpdate } = await import("./task-update.js");
    const program = new Command();
    registerTaskUpdate(program);
    await program.parseAsync([
      "node", "stoa",
      "task-update", "task-bar",
      "--expected-updated", "2026-05-21T00:00:00.000Z",
    ]);

    expect(handlerSpy).toHaveBeenCalledOnce();
    const [inputArg] = handlerSpy.mock.calls[0];
    expect(inputArg).not.toHaveProperty("agent_id");
  });
});
