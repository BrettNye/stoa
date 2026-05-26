// src/cli/commands/caller-migration-residuals.test.ts
//
// Verifies the diagnosis for 3 CLI command files that were flagged as possible
// v0.4 agent_id migration residuals.
//
// Result:
//   claim-task.ts:             calls CORE claimTask() — agent_id is a legitimate ClaimInput field (the agent to record as claimer). FINE AS-IS.
//   channel-post.ts:           calls CORE postToChannel() — agent_id is a legitimate PostInput field (author stamp). FINE AS-IS.
//   refresh-profile-memory.ts: calls TOOL handler — but agent_id here is a RESOURCE IDENTIFIER (which profile to refresh), NOT an actor. Input schema intentionally retains agent_id. FINE AS-IS.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// ---- claim-task.ts: calls CORE claimTask() with agent_id ----

import * as tasksModule from "../../core/tasks.js";
import * as claimCtxModule from "../_ctx.js";
import * as claimResolveWikiModule from "../../tools/_resolve-wiki.js";
import * as pagesModule from "../../core/pages.js";

describe("claim-task CLI: agent_id is a legitimate ClaimInput field (core function, not tool handler)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let claimTaskSpy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let getCtxSpy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let resolveWikiSpy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let readPageSpy: any;

  beforeEach(() => {
    claimTaskSpy = vi.spyOn(tasksModule, "claimTask").mockResolvedValue({
      task_id: "task-foo",
      claimed_by: "agent:worker",
      claimed_at: "2026-05-21T00:00:00.000Z",
      updated: "2026-05-21T00:00:00.000Z",
    });

    getCtxSpy = vi.spyOn(claimCtxModule, "getCtx").mockReturnValue({
      vaultPath: "/fake/vault",
      defaultWiki: "stoa",
    } as any);

    resolveWikiSpy = vi.spyOn(claimResolveWikiModule, "resolveWiki").mockReturnValue("stoa");

    readPageSpy = vi.spyOn(pagesModule, "readPage").mockReturnValue({
      id: "task-foo",
      updated: "2026-05-20T00:00:00.000Z",
      frontmatter: {},
      body: "",
      path: "wikis/stoa/task/task-foo.md",
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes agent_id as ClaimInput.agent_id (legitimate core function param — identifies the claimer)", async () => {
    const { registerClaimTask } = await import("./claim-task.js");
    const program = new Command();
    registerClaimTask(program);
    await program.parseAsync([
      "node", "stoa",
      "claim-task", "task-foo",
      "--as", "agent:worker",
    ]);

    expect(claimTaskSpy).toHaveBeenCalledOnce();
    const [, inputArg] = claimTaskSpy.mock.calls[0];
    // agent_id is a LEGITIMATE field in ClaimInput — it is the agent to record as claimer
    expect(inputArg).toHaveProperty("agent_id", "agent:worker");
    expect(inputArg).toHaveProperty("task_id", "task-foo");
  });

  it("does NOT route agent_id through ctx.principal (claimTask is a core function, not a tool handler)", async () => {
    const { registerClaimTask } = await import("./claim-task.js");
    const program = new Command();
    registerClaimTask(program);
    await program.parseAsync([
      "node", "stoa",
      "claim-task", "task-bar",
      "--as", "agent:worker-2",
    ]);

    expect(claimTaskSpy).toHaveBeenCalledOnce();
    // claimTask(vaultPath, input) — no ctx/principal argument
    expect(claimTaskSpy.mock.calls[0]).toHaveLength(2);
  });
});

// ---- channel-post.ts: calls CORE postToChannel() with agent_id ----

import * as channelModule from "../../core/channel.js";
import * as channelCtxModule from "../_ctx.js";
import * as channelResolveWikiModule from "../../tools/_resolve-wiki.js";

describe("channel-post CLI: agent_id is a legitimate PostInput field (core function, not tool handler)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let postToChannelSpy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let getCtxSpy2: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let resolveWikiSpy2: any;

  beforeEach(() => {
    postToChannelSpy = vi.spyOn(channelModule, "postToChannel").mockResolvedValue({
      id: "journal-2026-05-21-1200-hello",
      path: "wikis/stoa/journal/journal-2026-05-21-1200-hello.md",
      created: "2026-05-21T12:00:00.000Z",
      channel: "ops",
    });

    getCtxSpy2 = vi.spyOn(channelCtxModule, "getCtx").mockReturnValue({
      vaultPath: "/fake/vault",
      defaultWiki: "stoa",
    } as any);

    resolveWikiSpy2 = vi.spyOn(channelResolveWikiModule, "resolveWiki").mockReturnValue("stoa");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes agent_id as PostInput.agent_id (legitimate core function param — author stamp for the journal entry)", async () => {
    const { registerChannelPost } = await import("./channel-post.js");
    const program = new Command();
    registerChannelPost(program);
    await program.parseAsync([
      "node", "stoa",
      "channel-post", "ops", "hello world",
      "--agent-id", "agent:my-bot",
    ]);

    expect(postToChannelSpy).toHaveBeenCalledOnce();
    const [, inputArg] = postToChannelSpy.mock.calls[0];
    // agent_id is a LEGITIMATE field in PostInput — it stamps the author on the journal entry
    expect(inputArg).toHaveProperty("agent_id", "agent:my-bot");
    expect(inputArg).toHaveProperty("channel", "ops");
  });

  it("defaults agent_id to 'claude-code' when --agent-id flag is omitted", async () => {
    const { registerChannelPost } = await import("./channel-post.js");
    const program = new Command();
    registerChannelPost(program);
    await program.parseAsync([
      "node", "stoa",
      "channel-post", "ops", "hello",
    ]);

    expect(postToChannelSpy).toHaveBeenCalledOnce();
    const [, inputArg] = postToChannelSpy.mock.calls[0];
    expect(inputArg).toHaveProperty("agent_id", "claude-code");
  });
});

// ---- refresh-profile-memory.ts: agent_id is a RESOURCE IDENTIFIER, not an actor ----

import * as refreshModule from "../../tools/refresh-profile-memory.js";
import * as refreshCtxModule from "../_ctx.js";

describe("refresh-profile-memory CLI: agent_id is a resource identifier in input (correct — which profile to refresh)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let handlerSpy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let getCtxSpy3: any;

  beforeEach(() => {
    handlerSpy = vi.spyOn(refreshModule.refreshProfileMemoryTool, "handler").mockResolvedValue({
      memory_page_id: "synthesis-charmander-memory",
      path: "wikis/_agents/synthesis/synthesis-charmander-memory.md",
      inputs_used_count: 3,
      last_compiled: "2026-05-21",
      caller_trainer_id: undefined,
    } as any);

    getCtxSpy3 = vi.spyOn(refreshCtxModule, "getCtx").mockReturnValue({
      vaultPath: "/fake/vault",
      defaultWiki: "stoa",
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes agent_id in the input object (resource identifier — which profile, NOT who is acting)", async () => {
    const { registerRefreshProfileMemory } = await import("./refresh-profile-memory.js");
    const program = new Command();
    registerRefreshProfileMemory(program);
    await program.parseAsync([
      "node", "stoa",
      "refresh-profile-memory", "charmander",
    ]);

    expect(handlerSpy).toHaveBeenCalledOnce();
    const [inputArg] = handlerSpy.mock.calls[0];
    // agent_id in input is CORRECT here — it identifies the profile resource to compile,
    // not the actor performing the action. The tool's Input schema intentionally retains it.
    expect(inputArg).toHaveProperty("agent_id", "charmander");
  });

  it("does NOT pass agent_id via ctx.principal (not the actor pattern)", async () => {
    const { registerRefreshProfileMemory } = await import("./refresh-profile-memory.js");
    const program = new Command();
    registerRefreshProfileMemory(program);
    await program.parseAsync([
      "node", "stoa",
      "refresh-profile-memory", "squirtle",
    ]);

    expect(handlerSpy).toHaveBeenCalledOnce();
    const [, ctxArg] = handlerSpy.mock.calls[0];
    // The ctx for this handler is just { vaultPath } — no principal needed
    expect(ctxArg).not.toHaveProperty("principal");
    expect(ctxArg).toHaveProperty("vaultPath", "/fake/vault");
  });
});
