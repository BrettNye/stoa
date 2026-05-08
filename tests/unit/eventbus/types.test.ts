import { describe, it, expect } from "vitest";
import { Cursor, type VaultEvent, type Filter } from "../../../src/core/eventbus/types.js";

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
