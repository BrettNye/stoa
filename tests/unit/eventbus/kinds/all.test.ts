import { it, expect } from "vitest";
import { allBehavior } from "../../../../src/core/eventbus/kinds/all.js";
import { Cursor } from "../../../../src/core/eventbus/types.js";
import type { VaultEvent } from "../../../../src/core/eventbus/types.js";

const ev = (id: string, channel?: string): VaultEvent => ({
  source: "journal", wiki: "_meta", id, path: `/${id}.md`,
  change_kind: "add", mtime: "2026-05-08T12:00:00.000Z", channel,
});

it("isSatisfied only when every filter has a match", () => {
  let s = allBehavior.init(
    [{source: "journal", channel: "a"}, {source: "journal", channel: "b"}],
    [ev("p1", "a")],
  );
  expect(allBehavior.isSatisfied(s)).toBe(false);
  s = allBehavior.update(s, ev("p2", "b"), 1);
  expect(allBehavior.isSatisfied(s)).toBe(true);
});

it("init populates events[i] for each filter whose match is in caughtUp", () => {
  const s = allBehavior.init(
    [{source: "journal", channel: "a"}, {source: "journal", channel: "b"}, {source: "journal", channel: "c"}],
    [ev("p1", "a"), ev("p3", "c")],
  );
  expect(s.events[0]).not.toBeNull();
  expect(s.events[1]).toBeNull();
  expect(s.events[2]).not.toBeNull();
  expect(s.resolved.has(0)).toBe(true);
  expect(s.resolved.has(1)).toBe(false);
  expect(s.resolved.has(2)).toBe(true);
});

it("update records at index i; further updates at same index are no-ops", () => {
  const s0 = allBehavior.init(
    [{source: "journal", channel: "a"}, {source: "journal", channel: "b"}],
    [],
  );
  const eventA1 = ev("p1", "a");
  const eventA2 = ev("p2", "a");
  const s1 = allBehavior.update(s0, eventA1, 0);
  expect(s1.events[0]).toBe(eventA1);
  const s2 = allBehavior.update(s1, eventA2, 0);
  expect(s2.events[0]).toBe(eventA1); // no-op, keeps first
});

it("toResult on timeout populates missing_filter_indices for unresolved filters", () => {
  const cursor = Cursor.fromIso("2026-05-08T12:00:00.000Z");
  const s = allBehavior.init(
    [{source: "journal", channel: "a"}, {source: "journal", channel: "b"}],
    [ev("p1", "a")],
  );
  const result = allBehavior.toResult(s, true, cursor);
  expect(result).toMatchObject({
    timed_out: true,
    cursor,
    missing_filter_indices: [1],
  });
  if ("events" in result) {
    expect(result.events.length).toBe(1);
  }
});

it("toResult on success omits missing_filter_indices", () => {
  const cursor = Cursor.fromIso("2026-05-08T12:00:00.000Z");
  let s = allBehavior.init(
    [{source: "journal", channel: "a"}, {source: "journal", channel: "b"}],
    [],
  );
  s = allBehavior.update(s, ev("p1", "a"), 0);
  s = allBehavior.update(s, ev("p2", "b"), 1);
  const result = allBehavior.toResult(s, false, cursor);
  expect(result).not.toHaveProperty("missing_filter_indices");
  expect(result).toMatchObject({ timed_out: false, cursor });
  if ("events" in result) {
    expect(result.events.length).toBe(2);
  }
});

it("toResult events array contains only non-null entries", () => {
  const cursor = Cursor.fromIso("2026-05-08T12:00:00.000Z");
  const s = allBehavior.init(
    [{source: "journal", channel: "a"}, {source: "journal", channel: "b"}],
    [],
  );
  const result = allBehavior.toResult(s, true, cursor);
  if ("events" in result) {
    expect(result.events.every(e => e !== null)).toBe(true);
    expect(result.events.length).toBe(0);
  }
});
