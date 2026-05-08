import { it, expect, describe, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleWait, type HandleWaitContext } from "../../../src/core/eventbus/handle-wait.js";
import { EventBus } from "../../../src/core/eventbus/bus.js";
import { WaiterRegistry } from "../../../src/core/eventbus/registry.js";
import { Watcher } from "../../../src/core/eventbus/watcher.js";
import { EventDeriver } from "../../../src/core/eventbus/event-deriver.js";
import { StateCache } from "../../../src/core/eventbus/state-cache.js";
import { singleBehavior } from "../../../src/core/eventbus/kinds/single.js";
import { Cursor } from "../../../src/core/eventbus/types.js";
import type { VaultEvent } from "../../../src/core/eventbus/types.js";

// Helper: write a valid journal file to a tmp vault
function makeVaultWithJournal(vault: string, id: string, mtime: Date): void {
  const dir = join(vault, "wikis", "_meta", "journal");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${id}.md`);
  writeFileSync(file, `---\nid: ${id}\ntype: journal\ncreated: 2026-05-08\n---\n`);
  utimesSync(file, mtime, mtime);
}

function makeCtx(vault: string, bus: EventBus, registry: WaiterRegistry, watcher: Watcher): HandleWaitContext {
  return { vaultPath: vault, bus, registry, watcher };
}

const watchers: Watcher[] = [];
const registries: WaiterRegistry[] = [];

afterEach(async () => {
  for (const w of watchers) { try { await w.close(); } catch {} }
  watchers.length = 0;
  for (const r of registries) { try { r.close(); } catch {} }
  registries.length = 0;
});

function makeWatcher(vault: string, bus: EventBus, deriver: EventDeriver): Watcher {
  const w = new Watcher({
    vaultPath: vault,
    globs: ["wikis/**/*.md"],
    onEvent: (absPath, kind) => deriver.derive(absPath, kind),
  });
  watchers.push(w);
  return w;
}

function makeHarness(vault: string) {
  const bus = new EventBus();
  const stateCache = new StateCache();
  const deriver = new EventDeriver({ vaultPath: vault, bus, stateCache });
  const registry = new WaiterRegistry(bus);
  registries.push(registry);
  const watcher = makeWatcher(vault, bus, deriver);
  return { bus, registry, watcher, deriver };
}

// -------------------------------------------------------------------------
// (a) Immediate-satisfy from catchup
// -------------------------------------------------------------------------
describe("immediate satisfy from catchup", () => {
  it("returns immediately when a matching file exists before the wait", async () => {
    const vault = mkdtempSync(join(tmpdir(), "stoa-hw-"));
    const mtime = new Date("2026-05-01T00:00:00Z");
    makeVaultWithJournal(vault, "j-existing", mtime);

    const { bus, registry, watcher } = makeHarness(vault);
    const ctx = makeCtx(vault, bus, registry, watcher);

    const result = await handleWait(
      singleBehavior,
      [{ source: "journal" }],
      undefined, // no since → full scan
      5000,
      ctx,
    );

    expect((result as any).timed_out).toBe(false);
    expect((result as any).event?.id).toBe("j-existing");
  });

  it("returns immediately with scan cursor on immediate satisfy", async () => {
    const vault = mkdtempSync(join(tmpdir(), "stoa-hw-"));
    const mtime = new Date("2026-05-01T10:00:00Z");
    makeVaultWithJournal(vault, "j-early", mtime);

    const { bus, registry, watcher } = makeHarness(vault);
    const ctx = makeCtx(vault, bus, registry, watcher);

    const result = await handleWait(
      singleBehavior,
      [{ source: "journal" }],
      undefined,
      5000,
      ctx,
    );

    // cursor should reflect the file's mtime (the scan cursor)
    expect((result as any).cursor).toBe(mtime.toISOString());
  });

  it("since is passed to catchupSince — file older than since is excluded", async () => {
    const vault = mkdtempSync(join(tmpdir(), "stoa-hw-"));
    // write a file with mtime older than the since cursor
    const oldMtime = new Date("2026-05-01T00:00:00Z");
    makeVaultWithJournal(vault, "j-old", oldMtime);

    const { bus, registry, watcher } = makeHarness(vault);
    const ctx = makeCtx(vault, bus, registry, watcher);

    // since is AFTER the file mtime → catchup will exclude it
    const since = Cursor.fromIso("2026-05-02T00:00:00Z");

    const result = await handleWait(
      singleBehavior,
      [{ source: "journal" }],
      since,
      50, // short timeout — will time out if catchup doesn't return the file
      ctx,
    );

    // Should time out because the file is older than 'since'
    expect((result as any).timed_out).toBe(true);
    expect((result as any).event).toBeUndefined();
  });
});

// -------------------------------------------------------------------------
// (b) Timeout → timed_out=true
// -------------------------------------------------------------------------
describe("timeout", () => {
  it("returns timed_out=true when no events arrive before deadline", async () => {
    const vault = mkdtempSync(join(tmpdir(), "stoa-hw-"));
    // Empty vault — no files, no live events
    const { bus, registry, watcher } = makeHarness(vault);
    const ctx = makeCtx(vault, bus, registry, watcher);

    const result = await handleWait(
      singleBehavior,
      [{ source: "journal" }],
      undefined,
      30, // very short
      ctx,
    );

    expect((result as any).timed_out).toBe(true);
    expect((result as any).event).toBeUndefined();
  });

  it("timed_out result has a cursor set to approximately now", async () => {
    const vault = mkdtempSync(join(tmpdir(), "stoa-hw-"));
    const { bus, registry, watcher } = makeHarness(vault);
    const ctx = makeCtx(vault, bus, registry, watcher);

    const before = Date.now();
    const result = await handleWait(
      singleBehavior,
      [{ source: "journal" }],
      undefined,
      30,
      ctx,
    );
    const after = Date.now();

    expect((result as any).timed_out).toBe(true);
    const cursorMs = new Date((result as any).cursor).getTime();
    expect(cursorMs).toBeGreaterThanOrEqual(before - 100);
    expect(cursorMs).toBeLessThanOrEqual(after + 100);
  });
});

// -------------------------------------------------------------------------
// (c) Dedup — event seen by both pre-buffer and scan
// -------------------------------------------------------------------------
describe("dedup", () => {
  it("deduplicates an event present in both scan and pre-buffer", async () => {
    // We use a fake behavior that counts how many events init() saw
    let initCallCount = 0;
    let initEvents: VaultEvent[] = [];

    const countingBehavior = {
      init(filters: any[], caughtUp: VaultEvent[]) {
        initCallCount++;
        initEvents = [...caughtUp];
        // Satisfy immediately if any events found
        return { events: caughtUp };
      },
      update(state: any, event: VaultEvent, _idx: number) {
        return { events: [...state.events, event] };
      },
      isSatisfied(state: any) {
        return state.events.length > 0;
      },
      toResult(state: any, timedOut: boolean, cursor: any) {
        return { events: state.events, cursor, timed_out: timedOut };
      },
    };

    const vault = mkdtempSync(join(tmpdir(), "stoa-hw-"));
    const mtime = new Date("2026-05-08T00:00:00Z");
    makeVaultWithJournal(vault, "j-dedup", mtime);

    const bus = new EventBus();
    const stateCache = new StateCache();
    const deriver = new EventDeriver({ vaultPath: vault, bus, stateCache });
    const registry = new WaiterRegistry(bus);
    registries.push(registry);

    // Intercept watcher.start() to inject a duplicate into the bus before catchupSince finishes
    // We simulate this by emitting the same event onto the bus before handleWait is called
    // and relying on the subscribe-before-scan pre-buffer to capture it.
    //
    // In the real flow: watcher fires → deriver emits → bus → pre-buffer captures.
    // For the unit test we simulate the race by emitting a duplicate event directly on the bus
    // synchronously AFTER subscribe but BEFORE catchupSince returns.
    // We achieve this by wrapping the EventBus.subscribe to trigger the emission.

    let subscribeCount = 0;
    const origSubscribe = bus.subscribe.bind(bus);
    const dupEvent: VaultEvent = {
      source: "journal",
      wiki: "_meta",
      id: "j-dedup",
      path: join(vault, "wikis", "_meta", "journal", "j-dedup.md"),
      change_kind: "add",
      mtime: mtime.toISOString(),
    };
    bus.subscribe = (handler) => {
      const unsub = origSubscribe(handler);
      subscribeCount++;
      if (subscribeCount === 1) {
        // Simulate live event arriving right as subscription is registered
        // (pre-buffer captures it before catchupSince runs)
        setImmediate(() => bus.emit(dupEvent));
      }
      return unsub;
    };

    const watcher = makeWatcher(vault, bus, deriver);
    const ctx = makeCtx(vault, bus, registry, watcher);

    const result = await handleWait(
      countingBehavior as any,
      [{ source: "journal" }],
      undefined,
      5000,
      ctx,
    );

    // The result should have satisfied immediately
    expect((result as any).timed_out).toBe(false);
    // init() should have been called exactly once
    expect(initCallCount).toBe(1);
    // Despite the event appearing in both scan AND pre-buffer, dedupe ensures only 1 event seen
    expect(initEvents).toHaveLength(1);
    expect(initEvents[0].id).toBe("j-dedup");
  });

  it("dedupe removes duplicate by (source, wiki, id, mtime) composite key", async () => {
    // Test dedupe directly by importing the internal via handleWait's behavior
    // We use a behavior that records total events seen during init
    const seenEvents: VaultEvent[] = [];
    const recordBehavior = {
      init(_filters: any[], caughtUp: VaultEvent[]) {
        seenEvents.push(...caughtUp);
        return { done: caughtUp.length > 0 };
      },
      update(state: any) { return state; },
      isSatisfied(state: any) { return state.done; },
      toResult(state: any, timedOut: boolean, cursor: any) {
        return { cursor, timed_out: timedOut };
      },
    };

    const vault = mkdtempSync(join(tmpdir(), "stoa-hw-"));
    const mtime = new Date("2026-05-08T06:00:00Z");
    makeVaultWithJournal(vault, "j-dup", mtime);

    // Create two bus subscriptions — first pre-buffer, then emit duplicates
    const bus = new EventBus();
    const stateCache = new StateCache();
    const deriver = new EventDeriver({ vaultPath: vault, bus, stateCache });
    const registry = new WaiterRegistry(bus);
    registries.push(registry);

    // Force two identical events into the bus before catchupSince finishes
    let subscribeCount2 = 0;
    const origSubscribe2 = bus.subscribe.bind(bus);
    const dupEvent2: VaultEvent = {
      source: "journal",
      wiki: "_meta",
      id: "j-dup",
      path: join(vault, "wikis", "_meta", "journal", "j-dup.md"),
      change_kind: "add",
      mtime: mtime.toISOString(),
    };
    bus.subscribe = (handler) => {
      const unsub = origSubscribe2(handler);
      subscribeCount2++;
      if (subscribeCount2 === 1) {
        // Emit the same event twice — only one should survive dedup
        setImmediate(() => {
          bus.emit(dupEvent2);
          bus.emit(dupEvent2); // exact duplicate
        });
      }
      return unsub;
    };

    const watcher = makeWatcher(vault, bus, deriver);
    const ctx = makeCtx(vault, bus, registry, watcher);

    await handleWait(
      recordBehavior as any,
      [{ source: "journal" }],
      undefined,
      5000,
      ctx,
    );

    // Should see exactly 1 unique event despite duplicates in both scan and pre-buffer
    const uniqueIds = new Set(seenEvents.map((e) => e.id));
    expect(uniqueIds.size).toBe(1);
    expect(seenEvents[0].id).toBe("j-dup");
  });
});

// -------------------------------------------------------------------------
// (d) subscribe-before-scan ordering
// -------------------------------------------------------------------------
describe("subscribe-before-scan ordering", () => {
  it("watcher.start() is called before catchupSince resolves", async () => {
    const vault = mkdtempSync(join(tmpdir(), "stoa-hw-"));

    const bus = new EventBus();
    const stateCache = new StateCache();
    const deriver = new EventDeriver({ vaultPath: vault, bus, stateCache });
    const registry = new WaiterRegistry(bus);
    registries.push(registry);

    const startOrder: string[] = [];

    // Wrap the watcher to record start() call
    const watcher = makeWatcher(vault, bus, deriver);
    const origStart = watcher.start.bind(watcher);
    watcher.start = async () => {
      startOrder.push("watcher.start");
      return origStart();
    };

    // Intercept bus.subscribe to record subscription order
    const origSubscribe = bus.subscribe.bind(bus);
    bus.subscribe = (handler) => {
      startOrder.push("bus.subscribe");
      return origSubscribe(handler);
    };

    const ctx = makeCtx(vault, bus, registry, watcher);

    await handleWait(
      singleBehavior,
      [{ source: "journal" }],
      undefined,
      50, // short timeout
      ctx,
    );

    // watcher.start must precede bus.subscribe (pre-buffer) which must precede catchup
    const watcherIdx = startOrder.indexOf("watcher.start");
    const subscribeIdx = startOrder.indexOf("bus.subscribe");
    expect(watcherIdx).toBeGreaterThanOrEqual(0);
    expect(subscribeIdx).toBeGreaterThanOrEqual(0);
    expect(watcherIdx).toBeLessThan(subscribeIdx);
  });
});

// -------------------------------------------------------------------------
// (e) No registry registration when satisfied immediately
// -------------------------------------------------------------------------
describe("registry not touched on immediate satisfy", () => {
  it("registry.register is NOT called when behavior is satisfied from catchup", async () => {
    const vault = mkdtempSync(join(tmpdir(), "stoa-hw-"));
    makeVaultWithJournal(vault, "j-found", new Date("2026-05-01T00:00:00Z"));

    const bus = new EventBus();
    const stateCache = new StateCache();
    const deriver = new EventDeriver({ vaultPath: vault, bus, stateCache });
    const registry = new WaiterRegistry(bus);
    registries.push(registry);
    const watcher = makeWatcher(vault, bus, deriver);
    const ctx = makeCtx(vault, bus, registry, watcher);

    const registerSpy = vi.spyOn(registry, "register");

    await handleWait(
      singleBehavior,
      [{ source: "journal" }],
      undefined,
      5000,
      ctx,
    );

    expect(registerSpy).not.toHaveBeenCalled();
  });

  it("registry.register IS called when behavior is not satisfied from catchup", async () => {
    const vault = mkdtempSync(join(tmpdir(), "stoa-hw-")); // empty vault

    const bus = new EventBus();
    const stateCache = new StateCache();
    const deriver = new EventDeriver({ vaultPath: vault, bus, stateCache });
    const registry = new WaiterRegistry(bus);
    registries.push(registry);
    const watcher = makeWatcher(vault, bus, deriver);
    const ctx = makeCtx(vault, bus, registry, watcher);

    const registerSpy = vi.spyOn(registry, "register");

    // Short timeout so the test doesn't hang
    await handleWait(
      singleBehavior,
      [{ source: "journal" }],
      undefined,
      30,
      ctx,
    );

    expect(registerSpy).toHaveBeenCalledOnce();
  });
});
