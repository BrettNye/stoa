import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { postToChannel, tailChannel } from "../../src/core/channel.js";
import { reindex } from "../../src/core/reindex.js";

let vault: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-chan-"));
  mkdirSync(join(vault, "wikis", "alpha", "journal"), { recursive: true });
  mkdirSync(join(vault, "_index"), { recursive: true });
  writeFileSync(join(vault, "_index", "pages.json"), JSON.stringify({ pages: [] }));
});

describe("postToChannel", () => {
  it("writes a journal entry with channel field set", async () => {
    const result = await postToChannel(vault, {
      channel: "test-chan",
      content: "hello",
      wiki: "alpha",
      agent_id: "claude-code"
    });
    expect(result.id).toMatch(/^journal-\d{4}-\d{2}-\d{2}-\d{4}-/);
    expect(result.channel).toBe("test-chan");
  });

  it("rejects invalid channel format", async () => {
    await expect(postToChannel(vault, {
      channel: "Bad Channel!",
      content: "x",
      wiki: "alpha",
      agent_id: "claude-code"
    })).rejects.toThrow();
  });
});

describe("tailChannel", () => {
  it("returns empty when no entries match", async () => {
    const result = tailChannel(vault, { channel: "empty", since: "2026-01-01T00:00:00Z" });
    expect(result.entries).toHaveLength(0);
  });

  it("returns entries on a channel ordered by created", async () => {
    await postToChannel(vault, { channel: "ordered", content: "first", wiki: "alpha", agent_id: "a" });
    await postToChannel(vault, { channel: "ordered", content: "second", wiki: "alpha", agent_id: "a" });
    // Reindex so tailChannel can find the just-posted entries via pages.json
    await reindex(vault);
    const result = tailChannel(vault, { channel: "ordered" });
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].body).toContain("first");
    expect(result.entries[1].body).toContain("second");
  });
});
