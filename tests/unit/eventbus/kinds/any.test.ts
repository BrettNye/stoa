import { it, expect } from "vitest";
import { anyBehavior } from "../../../../src/core/eventbus/kinds/any.js";
import type { VaultEvent } from "../../../../src/core/eventbus/types.js";
import { Cursor } from "../../../../src/core/eventbus/types.js";

const evJournal: VaultEvent = { source: "journal", wiki: "_meta", id: "x",
  path: "/p", change_kind: "add", mtime: "2026-05-08T12:00:00.000Z" };

const evTask: VaultEvent = { source: "task", wiki: "_meta", id: "t1",
  path: "/q", change_kind: "add", mtime: "2026-05-08T12:01:00.000Z" };

const cursor = Cursor.fromIso("2026-05-08T12:00:00.000Z");

it("init returns matched_filter_index for the first matching filter", () => {
  const s = anyBehavior.init(
    [{source: "task"}, {source: "journal"}],
    [evJournal],
  );
  expect(s.matched_filter_index).toBe(1);
  expect(anyBehavior.isSatisfied(s)).toBe(true);
});

it("init returns empty state when no caughtUp events match", () => {
  const s = anyBehavior.init(
    [{source: "task"}],
    [evJournal],
  );
  expect(s.event).toBeUndefined();
  expect(s.matched_filter_index).toBeUndefined();
  expect(anyBehavior.isSatisfied(s)).toBe(false);
});

it("init returns empty state when caughtUp is empty", () => {
  const s = anyBehavior.init([{source: "task"}], []);
  expect(anyBehavior.isSatisfied(s)).toBe(false);
});

it("init picks first matching filter when multiple filters could match", () => {
  const s = anyBehavior.init(
    [{source: "journal"}, {source: "journal", wiki: "_meta"}],
    [evJournal],
  );
  expect(s.matched_filter_index).toBe(0);
});

it("update stores event and matched_filter_index", () => {
  const initial = anyBehavior.init([], []);
  const s = anyBehavior.update(initial, evTask, 0);
  expect(s.event).toBe(evTask);
  expect(s.matched_filter_index).toBe(0);
  expect(anyBehavior.isSatisfied(s)).toBe(true);
});

it("update is a no-op after already satisfied", () => {
  const initial = anyBehavior.init([], []);
  const s1 = anyBehavior.update(initial, evJournal, 1);
  const s2 = anyBehavior.update(s1, evTask, 0);
  expect(s2.event).toBe(evJournal);
  expect(s2.matched_filter_index).toBe(1);
});

it("toResult returns event and matched_filter_index when satisfied", () => {
  const s = anyBehavior.init([{source: "journal"}], [evJournal]);
  const result = anyBehavior.toResult(s, false, cursor);
  expect(result).toMatchObject({
    event: evJournal,
    matched_filter_index: 0,
    timed_out: false,
    cursor,
  });
});

it("toResult returns no event when timed out with no match", () => {
  const s = anyBehavior.init([{source: "task"}], []);
  const result = anyBehavior.toResult(s, true, cursor);
  expect(result).toMatchObject({ cursor, timed_out: true });
  expect((result as { event?: VaultEvent }).event).toBeUndefined();
  expect((result as { matched_filter_index?: number }).matched_filter_index).toBeUndefined();
});
