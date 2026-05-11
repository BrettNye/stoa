import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listAllChannels, type ChannelSummary } from "../../src/core/channel.js";
import { reindex } from "../../src/core/reindex.js";

function seedJournal(
  vaultPath: string,
  wiki: string,
  id: string,
  channel: string,
  created: string,
  body = "entry body"
): void {
  mkdirSync(join(vaultPath, "wikis", wiki, "journal"), { recursive: true });
  writeFileSync(
    join(vaultPath, "wikis", wiki, "journal", `${id}.md`),
    `---\nid: ${id}\ntitle: Post\ntype: journal\nwiki: ${wiki}\ncreated: ${created}\nauthor: agent:charmander\nchannel: ${channel}\n---\n${body}\n`
  );
}

describe("listAllChannels", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "stoa-chl-"));
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    writeFileSync(join(vaultPath, "_index", "aliases.json"), "{}");
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("returns an empty array for an empty vault", async () => {
    await reindex(vaultPath);
    const channels = listAllChannels(vaultPath);
    expect(Array.isArray(channels)).toBe(true);
    expect(channels).toHaveLength(0);
  });

  it("enumerates distinct channels across journal entries", async () => {
    const now = new Date();
    const recentTs = new Date(now.getTime() - 1000).toISOString(); // 1 sec ago

    seedJournal(vaultPath, "alpha", "journal-2026-05-01-1000-a", "feat-x", recentTs, "alpha feat-x entry");
    seedJournal(vaultPath, "alpha", "journal-2026-05-01-1001-b", "feat-y", recentTs, "alpha feat-y entry");
    await reindex(vaultPath);

    const channels = listAllChannels(vaultPath);
    expect(channels).toHaveLength(2);

    const names = channels.map(c => c.name).sort();
    expect(names).toContain("feat-x");
    expect(names).toContain("feat-y");
  });

  it("same channel name in two wikis produces two distinct summaries", async () => {
    const recentTs = new Date(Date.now() - 1000).toISOString();

    seedJournal(vaultPath, "alpha", "journal-2026-05-01-1000-a1", "shared-chan", recentTs, "alpha entry");
    seedJournal(vaultPath, "beta", "journal-2026-05-01-1000-b1", "shared-chan", recentTs, "beta entry");
    await reindex(vaultPath);

    const channels = listAllChannels(vaultPath);
    expect(channels).toHaveLength(2);

    const wikis = channels.map(c => c.wiki).sort();
    expect(wikis).toContain("alpha");
    expect(wikis).toContain("beta");
  });

  it("count24h reflects entries within 24h window", async () => {
    const oldTs = "2020-01-01T00:00:00.000Z"; // definitely outside 24h
    const recentTs = new Date(Date.now() - 1000).toISOString();

    seedJournal(vaultPath, "alpha", "journal-2020-01-01-1000-old", "my-chan", oldTs, "old entry");
    seedJournal(vaultPath, "alpha", "journal-2026-05-01-1200-new", "my-chan", recentTs, "new entry");
    await reindex(vaultPath);

    const channels = listAllChannels(vaultPath);
    const summary = channels.find(c => c.name === "my-chan" && c.wiki === "alpha");
    expect(summary).toBeDefined();
    expect(summary!.count24h).toBe(1);
  });

  it("opts.wiki filters to one wiki only", async () => {
    const recentTs = new Date(Date.now() - 1000).toISOString();

    seedJournal(vaultPath, "alpha", "journal-2026-05-01-1000-a2", "shared-chan", recentTs, "alpha entry");
    seedJournal(vaultPath, "beta", "journal-2026-05-01-1000-b2", "shared-chan", recentTs, "beta entry");
    await reindex(vaultPath);

    const channels = listAllChannels(vaultPath, { wiki: "alpha" });
    expect(channels).toHaveLength(1);
    expect(channels[0].wiki).toBe("alpha");
  });

  it("opts.since overrides the default 24h cutoff for count24h", async () => {
    const oldTs = "2020-01-01T00:00:00.000Z";
    const midTs = "2023-01-01T00:00:00.000Z";
    const recentTs = new Date(Date.now() - 1000).toISOString();

    seedJournal(vaultPath, "alpha", "journal-2020-01-01-1000-a3", "evt-chan", oldTs, "old entry");
    seedJournal(vaultPath, "alpha", "journal-2023-01-01-1000-b3", "evt-chan", midTs, "mid entry");
    seedJournal(vaultPath, "alpha", "journal-2026-05-01-1200-c3", "evt-chan", recentTs, "new entry");
    await reindex(vaultPath);

    // since = 2022-01-01: both midTs and recentTs qualify (2 entries)
    const channels = listAllChannels(vaultPath, { since: "2022-01-01T00:00:00.000Z" });
    const summary = channels.find(c => c.name === "evt-chan" && c.wiki === "alpha");
    expect(summary).toBeDefined();
    expect(summary!.count24h).toBe(2);
  });

  it("lastEntry.excerpt is truncated to 240 characters", async () => {
    const recentTs = new Date(Date.now() - 1000).toISOString();
    const longBody = "x".repeat(300);

    seedJournal(vaultPath, "alpha", "journal-2026-05-01-1300-long", "long-chan", recentTs, longBody);
    await reindex(vaultPath);

    const channels = listAllChannels(vaultPath);
    const summary = channels.find(c => c.name === "long-chan");
    expect(summary).toBeDefined();
    expect(summary!.lastEntry).not.toBeNull();
    expect(summary!.lastEntry!.excerpt.length).toBeLessThanOrEqual(240);
  });

  it("results are sorted by lastEntry.ts descending", async () => {
    const olderTs = "2026-04-01T10:00:00.000Z";
    const newerTs = "2026-05-01T10:00:00.000Z";

    seedJournal(vaultPath, "alpha", "journal-2026-04-01-1000-x1", "chan-old", olderTs, "old");
    seedJournal(vaultPath, "alpha", "journal-2026-05-01-1000-x2", "chan-new", newerTs, "new");
    await reindex(vaultPath);

    // Pass a very old since to include both
    const channels = listAllChannels(vaultPath, { since: "2000-01-01T00:00:00.000Z" });
    expect(channels.length).toBeGreaterThanOrEqual(2);

    // chan-new (newer timestamp) should come first
    const idx1 = channels.findIndex(c => c.name === "chan-new");
    const idx2 = channels.findIndex(c => c.name === "chan-old");
    expect(idx1).toBeLessThan(idx2);
  });

  it("lastEntry has expected shape fields", async () => {
    const recentTs = new Date(Date.now() - 1000).toISOString();

    seedJournal(vaultPath, "alpha", "journal-2026-05-01-1400-shape", "shape-chan", recentTs, "body text");
    await reindex(vaultPath);

    const channels = listAllChannels(vaultPath);
    const summary = channels.find(c => c.name === "shape-chan");
    expect(summary).toBeDefined();
    const last = summary!.lastEntry;
    expect(last).not.toBeNull();
    expect(typeof last!.id).toBe("string");
    expect(typeof last!.wiki).toBe("string");
    expect(typeof last!.author).toBe("string");
    expect(typeof last!.ts).toBe("string");
    expect(typeof last!.excerpt).toBe("string");
    expect(typeof last!.channel).toBe("string");
    expect(typeof last!.pageId).toBe("string");
  });
});
