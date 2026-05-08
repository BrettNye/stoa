import { it, expect } from "vitest";
import { EventBus } from "../../../src/core/eventbus/bus.js";
import type { VaultEvent } from "../../../src/core/eventbus/types.js";

const testEvent: VaultEvent = {
  source: "journal",
  wiki: "_meta",
  id: "x",
  path: "/p",
  change_kind: "add",
  mtime: "2026-05-08T12:00:00.000Z",
};

it("delivers an event to a subscribed handler", () => {
  const bus = new EventBus();
  const seen: VaultEvent[] = [];
  bus.subscribe(e => seen.push(e));
  bus.emit(testEvent);
  expect(seen).toHaveLength(1);
  expect(seen[0]).toBe(testEvent);
});

it("delivers to multiple handlers", () => {
  const bus = new EventBus();
  const a: VaultEvent[] = [];
  const b: VaultEvent[] = [];
  bus.subscribe(e => a.push(e));
  bus.subscribe(e => b.push(e));
  bus.emit(testEvent);
  expect(a).toHaveLength(1);
  expect(b).toHaveLength(1);
});

it("unsubscribe removes the handler", () => {
  const bus = new EventBus();
  const seen: VaultEvent[] = [];
  const unsub = bus.subscribe(e => seen.push(e));
  unsub();
  bus.emit(testEvent);
  expect(seen).toHaveLength(0);
});

it("a throwing handler does not prevent other handlers from receiving the event", () => {
  const bus = new EventBus();
  const seen: VaultEvent[] = [];
  bus.subscribe(() => { throw new Error("boom"); });
  bus.subscribe(e => seen.push(e));
  expect(() => bus.emit(testEvent)).not.toThrow();
  expect(seen).toHaveLength(1);
});

it("adding a handler during emit does not cause duplicate delivery in the same emit call", () => {
  const bus = new EventBus();
  const seen: VaultEvent[] = [];
  bus.subscribe(() => {
    // add another handler mid-emit
    bus.subscribe(e => seen.push(e));
  });
  bus.emit(testEvent);
  // The newly added handler should NOT receive the in-flight event
  expect(seen).toHaveLength(0);
  // But it should receive the next event
  bus.emit(testEvent);
  expect(seen).toHaveLength(1);
});

it("removing a handler during emit does not cause missed delivery for already-snapshotted handlers", () => {
  const bus = new EventBus();
  const seen: VaultEvent[] = [];
  let unsub: (() => void) | null = null;
  unsub = bus.subscribe(() => { unsub?.(); });
  bus.subscribe(e => seen.push(e));
  bus.emit(testEvent);
  // second handler should still get the event even though first unsubscribed during emit
  expect(seen).toHaveLength(1);
});

it("subscriberCount reflects current subscriptions", () => {
  const bus = new EventBus();
  expect(bus.subscriberCount).toBe(0);
  const unsub1 = bus.subscribe(() => {});
  expect(bus.subscriberCount).toBe(1);
  const unsub2 = bus.subscribe(() => {});
  expect(bus.subscriberCount).toBe(2);
  unsub1();
  expect(bus.subscriberCount).toBe(1);
  unsub2();
  expect(bus.subscriberCount).toBe(0);
});

it("emit is synchronous — seen array is populated before emit returns", () => {
  const bus = new EventBus();
  const seen: VaultEvent[] = [];
  bus.subscribe(e => seen.push(e));
  bus.emit(testEvent);
  // If synchronous, seen is already populated here
  expect(seen).toHaveLength(1);
});
