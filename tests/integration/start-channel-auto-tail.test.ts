import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startTool } from "../../src/tools/start.js";
import { postToChannel } from "../../src/core/channel.js";
import { reindex } from "../../src/core/reindex.js";

function writeProfile(vaultPath: string, channelsTailed: string[]): void {
  const inline = channelsTailed.map(c => `"${c}"`).join(", ");
  writeFileSync(
    join(vaultPath, "wikis", "_agents", "profiles", "profile-charmander.md"),
    `---
id: profile-charmander
type: profile
title: Charmander
created: 2026-04-29
wiki: _agents
status: active
summary: Backend
pokemon_type: fire
evolution_stage: basic
moveset: []
channels_tailed: [${inline}]
---

# Charmander
`
  );
}

function writeJournal(
  vaultPath: string,
  opts: { channel: string; createdIso: string; body: string; idSuffix: string }
): void {
  const id = `journal-${opts.idSuffix}`;
  writeFileSync(
    join(vaultPath, "wikis", "alpha", "journal", `${id}.md`),
    `---
id: ${id}
title: 'Channel post: ${opts.channel}'
type: journal
wiki: alpha
created: '${opts.createdIso}'
author: 'agent:charmander'
channel: ${opts.channel}
---
${opts.body}
`
  );
}

describe("integration — start auto-tails channels declared on the active profile", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-int-start-autotail-"));
    mkdirSync(join(vaultPath, "wikis", "alpha", "journal"), { recursive: true });
    mkdirSync(join(vaultPath, "wikis", "_agents", "profiles"), { recursive: true });
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    writeFileSync(join(vaultPath, "_index", "aliases.json"), "{}");
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("auto-tails declared channels — when channels_tailed: [foo] and foo has 2 entries, channel_activity has unread_count: 2 for foo", async () => {
    writeProfile(vaultPath, ["foo"]);
    postToChannel(vaultPath, { channel: "foo", content: "first", wiki: "alpha", agent_id: "charmander" });
    postToChannel(vaultPath, { channel: "foo", content: "second", wiki: "alpha", agent_id: "charmander" });
    // Channel writes don't auto-reindex (Plan B Tier-2 friction; surfaced by UC3).
    // tailChannel reads from _index/pages.json, so a manual reindex is required for posts to appear.
    reindex(vaultPath);

    const r = await startTool.handler(
      { wiki: "alpha", pokemon: "charmander" },
      { vaultPath }
    );

    const fooEntries = r.channel_activity.filter(c => c.channel === "foo");
    expect(fooEntries).toHaveLength(1);
    expect(fooEntries[0].unread_count).toBe(2);
  });

  it("handles missing channel gracefully — channels_tailed: [nonexistent-channel] does not crash and reports zero unread", async () => {
    writeProfile(vaultPath, ["nonexistent-channel"]);

    const r = await startTool.handler(
      { wiki: "alpha", pokemon: "charmander" },
      { vaultPath }
    );

    expect(r).toBeDefined();
    expect(Array.isArray(r.channel_activity)).toBe(true);
    const entry = r.channel_activity.find(c => c.channel === "nonexistent-channel");
    // Contract: either omitted or present with unread_count: 0. Either is acceptable;
    // what is NOT acceptable is a crash or a positive unread_count for a channel with no posts.
    if (entry) {
      expect(entry.unread_count).toBe(0);
    }
  });

  it("respects since cursor for unread counts — only entries newer than `since` count toward unread_count", async () => {
    writeProfile(vaultPath, ["foo"]);
    writeJournal(vaultPath, {
      channel: "foo",
      createdIso: "2026-04-30T10:00:00.000Z",
      body: "old entry — should NOT count",
      idSuffix: "2026-04-30-1000-old"
    });
    writeJournal(vaultPath, {
      channel: "foo",
      createdIso: "2026-04-30T12:00:00.000Z",
      body: "new entry — should count",
      idSuffix: "2026-04-30-1200-new"
    });
    // Direct journal writes also don't auto-reindex; same friction.
    reindex(vaultPath);

    const r = await startTool.handler(
      {
        wiki: "alpha",
        pokemon: "charmander",
        since: "2026-04-30T11:00:00.000Z"
      },
      { vaultPath }
    );

    const fooEntry = r.channel_activity.find(c => c.channel === "foo");
    expect(fooEntry).toBeDefined();
    expect(fooEntry?.unread_count).toBe(1);
  });
});
