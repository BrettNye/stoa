import { it, expect } from "vitest";
import { catchupSince } from "../../../src/core/eventbus/catchup.js";
import { Cursor } from "../../../src/core/eventbus/types.js";
import { mkdtempSync, writeFileSync, mkdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

it("returns events with mtime > since, sorted ascending", async () => {
  const vault = mkdtempSync(join(tmpdir(), "stoa-c-"));
  mkdirSync(join(vault, "wikis", "_meta", "journal"), { recursive: true });
  const old = join(vault, "wikis", "_meta", "journal", "j-old.md");
  const neu = join(vault, "wikis", "_meta", "journal", "j-new.md");
  writeFileSync(old, "---\nid: j-old\ntype: journal\ncreated: 2026-05-07\n---\n");
  writeFileSync(neu, "---\nid: j-new\ntype: journal\ncreated: 2026-05-08\n---\n");
  utimesSync(old, new Date("2026-05-07T00:00:00Z"), new Date("2026-05-07T00:00:00Z"));
  utimesSync(neu, new Date("2026-05-08T00:00:00Z"), new Date("2026-05-08T00:00:00Z"));
  const r = await catchupSince(vault, [{ source: "journal" }],
    Cursor.fromIso("2026-05-07T12:00:00Z"));
  expect(r.events).toHaveLength(1);
  expect(r.events[0].id).toBe("j-new");
});

it("returns all matching events when since is undefined", async () => {
  const vault = mkdtempSync(join(tmpdir(), "stoa-c-"));
  mkdirSync(join(vault, "wikis", "mywiki", "journal"), { recursive: true });
  const f1 = join(vault, "wikis", "mywiki", "journal", "entry-a.md");
  const f2 = join(vault, "wikis", "mywiki", "journal", "entry-b.md");
  writeFileSync(f1, "---\nid: entry-a\ntype: journal\ncreated: 2026-05-01\n---\n");
  writeFileSync(f2, "---\nid: entry-b\ntype: journal\ncreated: 2026-05-02\n---\n");
  utimesSync(f1, new Date("2026-05-01T00:00:00Z"), new Date("2026-05-01T00:00:00Z"));
  utimesSync(f2, new Date("2026-05-02T00:00:00Z"), new Date("2026-05-02T00:00:00Z"));
  const r = await catchupSince(vault, [{ source: "journal" }], undefined);
  expect(r.events).toHaveLength(2);
  // sorted ascending
  expect(r.events[0].id).toBe("entry-a");
  expect(r.events[1].id).toBe("entry-b");
});

it("returns empty events and since cursor when wikis/ does not exist", async () => {
  const vault = mkdtempSync(join(tmpdir(), "stoa-c-"));
  const since = Cursor.fromIso("2026-05-01T00:00:00Z");
  const r = await catchupSince(vault, [{ source: "journal" }], since);
  expect(r.events).toHaveLength(0);
  expect(r.cursor).toBe(since);
});

it("returns epoch cursor when wikis/ does not exist and since is undefined", async () => {
  const vault = mkdtempSync(join(tmpdir(), "stoa-c-"));
  const r = await catchupSince(vault, [{ source: "journal" }], undefined);
  expect(r.events).toHaveLength(0);
  expect(r.cursor).toBe(new Date(0).toISOString());
});

it("cursor is max mtime observed", async () => {
  const vault = mkdtempSync(join(tmpdir(), "stoa-c-"));
  mkdirSync(join(vault, "wikis", "mywiki", "journal"), { recursive: true });
  const f1 = join(vault, "wikis", "mywiki", "journal", "entry-a.md");
  const f2 = join(vault, "wikis", "mywiki", "journal", "entry-b.md");
  writeFileSync(f1, "---\nid: entry-a\ntype: journal\ncreated: 2026-05-01\n---\n");
  writeFileSync(f2, "---\nid: entry-b\ntype: journal\ncreated: 2026-05-02\n---\n");
  utimesSync(f1, new Date("2026-05-01T00:00:00Z"), new Date("2026-05-01T00:00:00Z"));
  utimesSync(f2, new Date("2026-05-03T00:00:00Z"), new Date("2026-05-03T00:00:00Z"));
  const r = await catchupSince(vault, [{ source: "journal" }], undefined);
  expect(r.cursor).toBe(new Date("2026-05-03T00:00:00Z").toISOString());
});

it("silently skips files that fail parse", async () => {
  const vault = mkdtempSync(join(tmpdir(), "stoa-c-"));
  mkdirSync(join(vault, "wikis", "mywiki", "journal"), { recursive: true });
  const valid = join(vault, "wikis", "mywiki", "journal", "good.md");
  const bad = join(vault, "wikis", "mywiki", "journal", "bad.md");
  writeFileSync(valid, "---\nid: good\ntype: journal\ncreated: 2026-05-01\n---\n");
  writeFileSync(bad, "no frontmatter here");
  const r = await catchupSince(vault, [{ source: "journal" }], undefined);
  expect(r.events).toHaveLength(1);
  expect(r.events[0].id).toBe("good");
});

it("filters events by source — non-matching source excluded", async () => {
  const vault = mkdtempSync(join(tmpdir(), "stoa-c-"));
  mkdirSync(join(vault, "wikis", "mywiki", "journal"), { recursive: true });
  const f = join(vault, "wikis", "mywiki", "journal", "entry.md");
  writeFileSync(f, "---\nid: entry\ntype: journal\ncreated: 2026-05-01\n---\n");
  const r = await catchupSince(vault, [{ source: "task" }], undefined);
  expect(r.events).toHaveLength(0);
});
