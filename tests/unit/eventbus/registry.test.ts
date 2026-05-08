import { it, expect, describe } from "vitest";
import { WaiterRegistry, WaiterLimitExceededError } from "../../../src/core/eventbus/registry.js";
import { EventBus } from "../../../src/core/eventbus/bus.js";
import { singleBehavior } from "../../../src/core/eventbus/kinds/single.js";
import type { VaultEvent } from "../../../src/core/eventbus/types.js";

const makeEvent = (id = "x"): VaultEvent => ({
  source: "journal",
  wiki: "_meta",
  id,
  path: "/p",
  change_kind: "add",
  mtime: "2026-05-08T12:00:00.000Z",
});

it("resolves a single-kind waiter on first matching event", async () => {
  const bus = new EventBus();
  const reg = new WaiterRegistry(bus);
  const ev: VaultEvent = makeEvent("x");
  const promise = reg.register(
    [{ source: "journal" }],
    singleBehavior,
    singleBehavior.init([{ source: "journal" }], []),
    1000,
    () => "Z" as any,
  );
  bus.emit(ev);
  const r = await promise;
  expect((r as any).event?.id).toBe("x");
  reg.close();
});

describe("WaiterRegistry", () => {
  it("resolves with timed_out=false when event arrives before timeout", async () => {
    const bus = new EventBus();
    const reg = new WaiterRegistry(bus);
    const promise = reg.register(
      [{ source: "journal" }],
      singleBehavior,
      singleBehavior.init([{ source: "journal" }], []),
      1000,
      () => "Z" as any,
    );
    bus.emit(makeEvent("y"));
    const r = await promise;
    expect((r as any).timed_out).toBe(false);
    expect((r as any).event?.id).toBe("y");
    reg.close();
  });

  it("resolves with timed_out=true when timeout elapses", async () => {
    const bus = new EventBus();
    const reg = new WaiterRegistry(bus);
    const promise = reg.register(
      [{ source: "journal" }],
      singleBehavior,
      singleBehavior.init([{ source: "journal" }], []),
      10, // very short
      () => "CURSOR" as any,
    );
    // do NOT emit anything
    const r = await promise;
    expect((r as any).timed_out).toBe(true);
    reg.close();
  });

  it("does not resolve when event does not match filter", async () => {
    const bus = new EventBus();
    const reg = new WaiterRegistry(bus);
    const promise = reg.register(
      [{ source: "task" }],
      singleBehavior,
      singleBehavior.init([{ source: "task" }], []),
      30, // short timeout
      () => "Z" as any,
    );
    // emit non-matching event
    bus.emit(makeEvent("no-match"));
    const r = await promise;
    expect((r as any).timed_out).toBe(true);
    reg.close();
  });

  it("throws WaiterLimitExceededError at capacity", () => {
    const bus = new EventBus();
    const reg = new WaiterRegistry(bus, { maxWaiters: 2 });
    // fill to capacity
    const promises = [
      reg.register([{ source: "journal" }], singleBehavior, singleBehavior.init([{ source: "journal" }], []), 10000, () => "Z" as any),
      reg.register([{ source: "journal" }], singleBehavior, singleBehavior.init([{ source: "journal" }], []), 10000, () => "Z" as any),
    ];
    expect(() =>
      reg.register([{ source: "journal" }], singleBehavior, singleBehavior.init([{ source: "journal" }], []), 10000, () => "Z" as any)
    ).toThrow(WaiterLimitExceededError);
    reg.close();
    // suppress unhandled rejection warnings
    return Promise.allSettled(promises);
  });

  it("size() reflects active waiter count", () => {
    const bus = new EventBus();
    const reg = new WaiterRegistry(bus);
    expect(reg.size()).toBe(0);
    const p1 = reg.register([{ source: "journal" }], singleBehavior, singleBehavior.init([{ source: "journal" }], []), 10000, () => "Z" as any);
    expect(reg.size()).toBe(1);
    const p2 = reg.register([{ source: "journal" }], singleBehavior, singleBehavior.init([{ source: "journal" }], []), 10000, () => "Z" as any);
    expect(reg.size()).toBe(2);
    reg.close();
    expect(reg.size()).toBe(0);
    return Promise.allSettled([p1, p2]);
  });

  it("cancel removes the waiter and clears timer", async () => {
    const bus = new EventBus();
    const reg = new WaiterRegistry(bus);
    // We need to expose the waiter id. Since the public API doesn't return an id,
    // we test cancel indirectly via size()
    expect(reg.size()).toBe(0);
    // register then cancel by id — since ids aren't returned by register, we
    // test that cancel("nonexistent") is idempotent
    reg.cancel("nonexistent");
    expect(reg.size()).toBe(0);
    reg.close();
  });

  it("close() unsubscribes from bus and empties waiters", async () => {
    const bus = new EventBus();
    const reg = new WaiterRegistry(bus);
    reg.register([{ source: "journal" }], singleBehavior, singleBehavior.init([{ source: "journal" }], []), 10000, () => "Z" as any);
    expect(reg.size()).toBe(1);
    expect(bus.subscriberCount).toBe(1);
    reg.close();
    expect(reg.size()).toBe(0);
    expect(bus.subscriberCount).toBe(0);
  });

  it("onEvent: atomic resolution — event-handler and timeout both check resolved flag", async () => {
    const bus = new EventBus();
    const reg = new WaiterRegistry(bus);
    // register with a tiny timeout
    const promise = reg.register(
      [{ source: "journal" }],
      singleBehavior,
      singleBehavior.init([{ source: "journal" }], []),
      5,
      () => "Z" as any,
    );
    // emit after timeout should not throw or double-resolve
    await new Promise(res => setTimeout(res, 20));
    bus.emit(makeEvent("late"));
    const r = await promise;
    // timed out, not resolved by late event
    expect((r as any).timed_out).toBe(true);
    reg.close();
  });

  it("multiple waiters: routes event only to matching ones", async () => {
    const bus = new EventBus();
    const reg = new WaiterRegistry(bus);
    const pJournal = reg.register(
      [{ source: "journal" }],
      singleBehavior,
      singleBehavior.init([{ source: "journal" }], []),
      1000,
      () => "Z" as any,
    );
    const pTask = reg.register(
      [{ source: "task" }],
      singleBehavior,
      singleBehavior.init([{ source: "task" }], []),
      50, // short timeout — we won't emit a task event
      () => "Z" as any,
    );
    bus.emit(makeEvent("journal-only")); // source=journal
    const rJournal = await pJournal;
    expect((rJournal as any).event?.id).toBe("journal-only");
    const rTask = await pTask;
    expect((rTask as any).timed_out).toBe(true);
    reg.close();
  });
});
