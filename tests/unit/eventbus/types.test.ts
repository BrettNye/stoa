import { it, expect } from "vitest";
import { Cursor, type WaitResult, type VaultEvent, type Filter } from "../../../src/core/eventbus/types.js";

it("Cursor.fromIso/toIso round-trips", () => {
  const iso = "2026-05-08T12:00:00.000Z";
  expect(Cursor.toIso(Cursor.fromIso(iso))).toBe(iso);
});

it("VaultEvent.channel is optional", () => {
  const e: VaultEvent = {
    source: "journal", wiki: "_meta", id: "j-1", path: "/x.md",
    change_kind: "add", mtime: "2026-05-08T12:00:00.000Z",
  };
  expect(e.channel).toBeUndefined();
});

it("WaitResult member 1 (singular) narrows on absence of events property", () => {
  const cursor = Cursor.fromIso("2026-05-08T12:00:00.000Z");
  const r: WaitResult = { cursor, timed_out: false };
  // member 1 has no required `events` — narrowing on 'events' in r distinguishes the two members
  if ("events" in r) {
    // member 2
    expect(Array.isArray(r.events)).toBe(true);
  } else {
    // member 1
    expect(r.event).toBeUndefined();
  }
});

it("WaitResult member 2 (plural) narrows on presence of events property", () => {
  const cursor = Cursor.fromIso("2026-05-08T12:00:00.000Z");
  const r: WaitResult = { events: [], cursor, timed_out: true };
  if ("events" in r) {
    expect(r.events).toEqual([]);
  } else {
    throw new Error("should have been member 2");
  }
});
