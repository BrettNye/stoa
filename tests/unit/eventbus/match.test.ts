import { it, expect } from "vitest";
import { matchFilter } from "../../../src/core/eventbus/match.js";
import type { VaultEvent } from "../../../src/core/eventbus/types.js";

const baseEvent: VaultEvent = {
  source: "journal", wiki: "_meta", id: "journal-x",
  path: "/p", change_kind: "add", mtime: "2026-05-08T12:00:00.000Z",
};

it("rejects when source differs", () => {
  expect(matchFilter({ source: "task" }, baseEvent)).toBe(false);
});

it("matches when source equals event source", () => {
  expect(matchFilter({ source: "journal" }, baseEvent)).toBe(true);
});

it("wiki narrows when set — matches when equal", () => {
  expect(matchFilter({ source: "journal", wiki: "_meta" }, baseEvent)).toBe(true);
});

it("wiki narrows when set — rejects when different", () => {
  expect(matchFilter({ source: "journal", wiki: "other" }, baseEvent)).toBe(false);
});

it("wiki absent matches any wiki", () => {
  expect(matchFilter({ source: "journal" }, { ...baseEvent, wiki: "anything" })).toBe(true);
});

it("id narrows when set — matches when equal", () => {
  expect(matchFilter({ source: "journal", id: "journal-x" }, baseEvent)).toBe(true);
});

it("id narrows when set — rejects when different", () => {
  expect(matchFilter({ source: "journal", id: "journal-y" }, baseEvent)).toBe(false);
});

it("id absent matches any id", () => {
  expect(matchFilter({ source: "journal" }, { ...baseEvent, id: "anything" })).toBe(true);
});

it("matches channel only when event has matching channel and source=journal", () => {
  expect(matchFilter({ source: "journal", channel: "duel-x" },
    { ...baseEvent, channel: "duel-x" })).toBe(true);
  expect(matchFilter({ source: "journal", channel: "duel-x" },
    { ...baseEvent, channel: "other" })).toBe(false);
  expect(matchFilter({ source: "journal", channel: "duel-x" },
    baseEvent)).toBe(false);
});

it("channel filter on non-journal source always returns false (source mismatch caught first)", () => {
  // source !== "journal" so the source check catches it
  expect(matchFilter({ source: "task", channel: "duel-x" },
    { ...baseEvent, source: "task", channel: "duel-x" })).toBe(false);
});
