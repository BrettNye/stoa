import { it, expect } from "vitest";
import { singleBehavior } from "../../../../src/core/eventbus/kinds/single.js";
import { Cursor } from "../../../../src/core/eventbus/types.js";
import type { VaultEvent } from "../../../../src/core/eventbus/types.js";

const ev: VaultEvent = {
  source: "journal",
  wiki: "_meta",
  id: "x",
  path: "/p",
  change_kind: "add",
  mtime: "2026-05-08T12:00:00.000Z",
};

const ev2: VaultEvent = {
  source: "journal",
  wiki: "_meta",
  id: "y",
  path: "/q",
  change_kind: "change",
  mtime: "2026-05-08T13:00:00.000Z",
};

it("init with empty caughtUp returns {event: undefined}, isSatisfied false", () => {
  const s = singleBehavior.init([{ source: "journal" }], []);
  expect(s.event).toBeUndefined();
  expect(singleBehavior.isSatisfied(s)).toBe(false);
});

it("init pre-fills from caughtUp[0] if any", () => {
  const s = singleBehavior.init([{ source: "journal" }], [ev]);
  expect(singleBehavior.isSatisfied(s)).toBe(true);
  expect(s.event).toBe(ev);
});

it("init with non-empty caughtUp: further update calls are no-ops", () => {
  const s0 = singleBehavior.init([{ source: "journal" }], [ev]);
  const s1 = singleBehavior.update(s0, ev2, 0);
  expect(s1.event).toBe(ev);
});

it("update sets event when state is empty, isSatisfied becomes true", () => {
  const s0 = singleBehavior.init([{ source: "journal" }], []);
  const s1 = singleBehavior.update(s0, ev, 0);
  expect(singleBehavior.isSatisfied(s1)).toBe(true);
  expect(s1.event).toBe(ev);
});

it("update after already satisfied is a no-op", () => {
  const s0 = singleBehavior.init([{ source: "journal" }], []);
  const s1 = singleBehavior.update(s0, ev, 0);
  const s2 = singleBehavior.update(s1, ev2, 0);
  expect(s2.event).toBe(ev);
});

it("toResult returns {event, cursor, timed_out} shape", () => {
  const cursor = Cursor.fromIso("2026-05-08T12:00:00.000Z");
  const s = singleBehavior.init([{ source: "journal" }], [ev]);
  const result = singleBehavior.toResult(s, false, cursor);
  expect(result).toMatchObject({ event: ev, cursor, timed_out: false });
});

it("toResult with timed_out=true reflects that", () => {
  const cursor = Cursor.fromIso("2026-05-08T12:00:00.000Z");
  const s = singleBehavior.init([{ source: "journal" }], []);
  const result = singleBehavior.toResult(s, true, cursor);
  expect(result).toMatchObject({ event: undefined, cursor, timed_out: true });
});
