import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { computeChannelActivity } from "../../src/core/start.js";
import { postToChannel } from "../../src/core/channel.js";
import { reindex } from "../../src/core/reindex.js";

describe("computeChannelActivity", () => {
  let vault: string;

  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), "vault-start-core-"));
    mkdirSync(join(vault, "wikis", "alpha", "journal"), { recursive: true });
    mkdirSync(join(vault, "_index"), { recursive: true });
    writeFileSync(join(vault, "_index", "pages.json"), JSON.stringify({ pages: [] }));
  });

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
  });

  it("returns [] for an empty channels list", () => {
    const result = computeChannelActivity(vault, [], { wiki: "alpha" });
    expect(result).toEqual([]);
  });

  it("emits an entry per declared channel even when the channel has no posts", () => {
    const result = computeChannelActivity(vault, ["quiet-channel"], { wiki: "alpha" });
    expect(result).toEqual([
      { channel: "quiet-channel", unread_count: 0, last_entry_summary: "" }
    ]);
  });

  it("counts unread entries and surfaces the last entry's body as summary", () => {
    postToChannel(vault, { channel: "active-chan", content: "first post body", wiki: "alpha", agent_id: "charmander" });
    postToChannel(vault, { channel: "active-chan", content: "second post body", wiki: "alpha", agent_id: "charmander" });
    reindex(vault);
    const result = computeChannelActivity(vault, ["active-chan"], { wiki: "alpha" });
    expect(result).toHaveLength(1);
    expect(result[0].channel).toBe("active-chan");
    expect(result[0].unread_count).toBe(2);
    expect(result[0].last_entry_summary).toContain("second post body");
  });

  it("preserves the input channel order across multiple channels", () => {
    postToChannel(vault, { channel: "alpha-chan", content: "a", wiki: "alpha", agent_id: "x" });
    postToChannel(vault, { channel: "beta-chan", content: "b", wiki: "alpha", agent_id: "x" });
    reindex(vault);
    const result = computeChannelActivity(vault, ["beta-chan", "alpha-chan", "gamma-chan"], { wiki: "alpha" });
    expect(result.map(r => r.channel)).toEqual(["beta-chan", "alpha-chan", "gamma-chan"]);
  });

  it("honors the since cutoff when tailing", () => {
    postToChannel(vault, { channel: "since-chan", content: "old entry", wiki: "alpha", agent_id: "x" });
    reindex(vault);
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const result = computeChannelActivity(vault, ["since-chan"], { wiki: "alpha", since: future });
    expect(result[0].unread_count).toBe(0);
    expect(result[0].last_entry_summary).toBe("");
  });

  it("truncates last_entry_summary to 120 characters by default", () => {
    const longBody = "x".repeat(300);
    postToChannel(vault, { channel: "long-chan", content: longBody, wiki: "alpha", agent_id: "x" });
    reindex(vault);
    const result = computeChannelActivity(vault, ["long-chan"], { wiki: "alpha" });
    expect(result[0].last_entry_summary.length).toBe(120);
  });
});
