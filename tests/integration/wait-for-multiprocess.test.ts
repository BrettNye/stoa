/**
 * Multi-process correctness floor tests.
 *
 * Two independent eventbus stacks (EventBus A + Watcher A + WaiterRegistry A;
 * same for B) watch the same tmp vault. Writing a journal entry must cause both
 * stacks to independently resolve their respective wait-for invocations.
 *
 * This demonstrates that N vault-mcp processes on one host each route their own
 * events from the FS without coordination (filesystem fan-out model).
 *
 * We simulate multi-process isolation by constructing two fully independent
 * stack instances in the same vitest worker — they share no in-memory state,
 * only the filesystem. This is functionally equivalent to two OS processes both
 * watching the same vault directory.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { EventBus } from "../../src/core/eventbus/bus.js";
import { StateCache } from "../../src/core/eventbus/state-cache.js";
import { EventDeriver } from "../../src/core/eventbus/event-deriver.js";
import { Watcher } from "../../src/core/eventbus/watcher.js";
import { WaiterRegistry } from "../../src/core/eventbus/registry.js";
import { getAllGlobs } from "../../src/core/eventbus/matchers/index.js";

import { waitForTool } from "../../src/tools/wait-for.js";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

interface Stack {
  bus: EventBus;
  stateCache: StateCache;
  deriver: EventDeriver;
  watcher: Watcher;
  registry: WaiterRegistry;
}

function buildStack(vaultPath: string): Stack {
  const bus = new EventBus();
  const stateCache = new StateCache();
  const deriver = new EventDeriver({ vaultPath, bus, stateCache });
  const watcher = new Watcher({
    vaultPath,
    globs: getAllGlobs(),
    onEvent: (path, kind) => deriver.derive(path, kind),
    awaitStabilityMs: 50,
    awaitPollMs: 10,
  });
  const registry = new WaiterRegistry(bus);
  return { bus, stateCache, deriver, watcher, registry };
}

async function teardownStack(stack: Stack): Promise<void> {
  stack.registry.close();
  await stack.watcher.close();
}

function makeCtx(vaultPath: string, stack: Stack) {
  return {
    vaultPath,
    bus: stack.bus,
    registry: stack.registry,
    watcher: stack.watcher,
  };
}

function writeJournal(
  vaultPath: string,
  wiki: string,
  slug: string,
  channel: string,
  body = "multiprocess test body",
): string {
  const dir = join(vaultPath, "wikis", wiki, "journal");
  mkdirSync(dir, { recursive: true });
  const id = `journal-${slug}`;
  const filePath = join(dir, `${id}.md`);
  const created = new Date().toISOString().slice(0, 10);
  writeFileSync(
    filePath,
    `---
id: ${id}
title: "Channel post: ${slug}"
type: journal
wiki: ${wiki}
created: ${created}
author: agent:test
channel: ${channel}
---

${body}
`,
  );
  return filePath;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ──────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ──────────────────────────────────────────────────────────────────────────────

let vault: string;
let stackA: Stack;
let stackB: Stack;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-wf-mp-"));
  mkdirSync(join(vault, "wikis"), { recursive: true });
  stackA = buildStack(vault);
  stackB = buildStack(vault);
});

afterEach(async () => {
  await Promise.all([teardownStack(stackA), teardownStack(stackB)]);
  rmSync(vault, { recursive: true, force: true });
});

// ──────────────────────────────────────────────────────────────────────────────
// Multi-process delivery
// ──────────────────────────────────────────────────────────────────────────────

describe("Multi-process — two independent stacks watching the same vault", () => {
  it("both stacks resolve their wait-for independently when a journal is written", async () => {
    const ctxA = makeCtx(vault, stackA);
    const ctxB = makeCtx(vault, stackB);

    // Both stacks register a wait-for
    const waitA = waitForTool.handler(
      waitForTool.inputSchema.parse({
        mode: "next",
        filter: { source: "journal", channel: "mp-test-chan" },
        timeout_ms: 6000,
      }),
      ctxA,
    );

    const waitB = waitForTool.handler(
      waitForTool.inputSchema.parse({
        mode: "next",
        filter: { source: "journal", channel: "mp-test-chan" },
        timeout_ms: 6000,
      }),
      ctxB,
    );

    // Give both watchers time to start
    await sleep(300);

    // Write a single journal entry — both stacks should see it via FS
    writeJournal(vault, "alpha", "2026-01-01-1000-mp", "mp-test-chan");

    const [resultA, resultB] = await Promise.all([waitA, waitB]);

    // Stack A resolved
    expect(resultA.timed_out).toBe(false);
    expect("event" in resultA).toBe(true);
    if ("event" in resultA && resultA.event) {
      expect(resultA.event.source).toBe("journal");
      expect(resultA.event.channel).toBe("mp-test-chan");
    }

    // Stack B resolved independently
    expect(resultB.timed_out).toBe(false);
    expect("event" in resultB).toBe(true);
    if ("event" in resultB && resultB.event) {
      expect(resultB.event.source).toBe("journal");
      expect(resultB.event.channel).toBe("mp-test-chan");
    }
  });

  it("the two stacks have no shared state (independent buses)", async () => {
    // Emit an event on stack A's bus directly
    const testEvent = {
      source: "journal",
      wiki: "alpha",
      id: "journal-bus-isolation-test",
      path: "/fake/path.md",
      change_kind: "add" as const,
      mtime: new Date().toISOString(),
      channel: "bus-isolation-chan",
    };

    let stackBReceived = false;
    const unsubB = stackB.bus.subscribe(() => {
      stackBReceived = true;
    });

    // Emit only on stackA's bus
    stackA.bus.emit(testEvent);

    await sleep(50);

    // Stack B should NOT have received anything since its bus is independent
    expect(stackBReceived).toBe(false);

    unsubB();
  });

  it("both stacks receive the same FS event independently via chokidar fan-out", async () => {
    const ctxA = makeCtx(vault, stackA);
    const ctxB = makeCtx(vault, stackB);

    // Start both watchers explicitly
    await Promise.all([stackA.watcher.start(), stackB.watcher.start()]);
    await sleep(100);

    // Register counts of events received on each bus
    const eventsA: string[] = [];
    const eventsB: string[] = [];
    const unsubA = stackA.bus.subscribe((e) => eventsA.push(e.id));
    const unsubB = stackB.bus.subscribe((e) => eventsB.push(e.id));

    // Write one file
    writeJournal(vault, "alpha", "2026-01-01-1000-fanout", "fanout-chan");

    // Wait for both watchers to fire
    await sleep(600);

    unsubA();
    unsubB();

    // Both stacks should have received the event
    expect(eventsA.length).toBeGreaterThanOrEqual(1);
    expect(eventsB.length).toBeGreaterThanOrEqual(1);

    // Both should have the same journal id
    expect(eventsA).toContain("journal-2026-01-01-1000-fanout");
    expect(eventsB).toContain("journal-2026-01-01-1000-fanout");
  });

  it("each stack's registry handles its own timeout independently", async () => {
    const ctxA = makeCtx(vault, stackA);
    const ctxB = makeCtx(vault, stackB);

    // Start both waiting, never write anything
    const [resultA, resultB] = await Promise.all([
      waitForTool.handler(
        waitForTool.inputSchema.parse({
          mode: "next",
          filter: { source: "journal", channel: "mp-timeout-a" },
          timeout_ms: 250,
        }),
        ctxA,
      ),
      waitForTool.handler(
        waitForTool.inputSchema.parse({
          mode: "next",
          filter: { source: "journal", channel: "mp-timeout-b" },
          timeout_ms: 250,
        }),
        ctxB,
      ),
    ]);

    expect(resultA.timed_out).toBe(true);
    expect(resultB.timed_out).toBe(true);
    // Each has its own fresh cursor
    expect(typeof resultA.cursor).toBe("string");
    expect(typeof resultB.cursor).toBe("string");
  });

  it("writing to one channel only satisfies the matching stack wait", async () => {
    const ctxA = makeCtx(vault, stackA);
    const ctxB = makeCtx(vault, stackB);

    // Stack A waits for chan-alpha; Stack B waits for chan-beta
    const waitA = waitForTool.handler(
      waitForTool.inputSchema.parse({
        mode: "next",
        filter: { source: "journal", channel: "chan-alpha" },
        timeout_ms: 1000,
      }),
      ctxA,
    );

    const waitB = waitForTool.handler(
      waitForTool.inputSchema.parse({
        mode: "next",
        filter: { source: "journal", channel: "chan-beta" },
        timeout_ms: 400,
      }),
      ctxB,
    );

    await sleep(200);

    // Only write to chan-alpha
    writeJournal(vault, "alpha", "2026-01-01-1000-selective", "chan-alpha");

    const [resultA, resultB] = await Promise.all([waitA, waitB]);

    // Stack A should resolve (got its event)
    expect(resultA.timed_out).toBe(false);
    if ("event" in resultA && resultA.event) {
      expect(resultA.event.channel).toBe("chan-alpha");
    }

    // Stack B should time out (chan-beta never got a write)
    expect(resultB.timed_out).toBe(true);
  });
});
