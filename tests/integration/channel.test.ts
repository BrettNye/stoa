import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { postToChannel, tailChannel } from "../../src/core/channel.js";
import { reindex } from "../../src/core/reindex.js";
import { channelTool } from "../../src/tools/channel.js";

let vault: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-chan-"));
  mkdirSync(join(vault, "wikis", "alpha", "journal"), { recursive: true });
  mkdirSync(join(vault, "_index"), { recursive: true });
  writeFileSync(join(vault, "_index", "pages.json"), JSON.stringify({ pages: [] }));
  writeFileSync(join(vault, "_index", "aliases.json"), "{}");
  writeFileSync(join(vault, ".active-wiki"), "alpha");
});

describe("postToChannel (core)", () => {
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

describe("tailChannel (core)", () => {
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

describe("channelTool — mode=post", () => {
  it("writes a channel journal entry via the tool (mode=post)", async () => {
    const ctx = { vaultPath: vault, defaultWiki: "alpha" };
    const result = await channelTool.handler(
      { mode: "post", channel: "tool-chan", content: "tool post", wiki: "alpha" },
      ctx
    );
    expect(result.id).toMatch(/^journal-/);
    expect(result.channel).toBe("tool-chan");
  });

  it("stamps agent_id from principal", async () => {
    const ctx = {
      vaultPath: vault,
      defaultWiki: "alpha",
      principal: { agent_id: "test-agent" }
    };
    const result = await channelTool.handler(
      { mode: "post", channel: "agent-chan", content: "from agent", wiki: "alpha" },
      ctx
    );
    expect(result.id).toMatch(/^journal-/);
    expect(result.channel).toBe("agent-chan");
  });

  it("defaults agent_id to stoa-local when no principal", async () => {
    const ctx = { vaultPath: vault, defaultWiki: "alpha" };
    const result = await channelTool.handler(
      { mode: "post", channel: "default-agent-chan", content: "no principal", wiki: "alpha" },
      ctx
    );
    expect(result.id).toMatch(/^journal-/);
  });

  it("throws named error when content is missing in post mode", async () => {
    const ctx = { vaultPath: vault, defaultWiki: "alpha" };
    await expect(
      channelTool.handler(
        { mode: "post", channel: "no-content" },
        ctx
      )
    ).rejects.toThrow(/vault_channel mode=post.*requires.*content/i);
  });
});

describe("channelTool — mode=tail", () => {
  it("returns empty entries when no channel messages exist", async () => {
    const ctx = { vaultPath: vault };
    const result = await channelTool.handler(
      { mode: "tail", channel: "empty-tail", since: "2026-01-01T00:00:00Z" },
      ctx
    );
    expect(result.entries).toHaveLength(0);
  });

  it("returns entries on a channel when tail mode is used", async () => {
    await postToChannel(vault, { channel: "tail-test", content: "msg1", wiki: "alpha", agent_id: "a" });
    await postToChannel(vault, { channel: "tail-test", content: "msg2", wiki: "alpha", agent_id: "a" });
    await reindex(vault);
    const ctx = { vaultPath: vault };
    const result = await channelTool.handler(
      { mode: "tail", channel: "tail-test" },
      ctx
    );
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].body).toContain("msg1");
    expect(result.entries[1].body).toContain("msg2");
  });
});

describe("channelTool — scope.axis", () => {
  it("resolves scope.axis for post mode", () => {
    const axis = (channelTool.scope.axis as Function)({ mode: "post", channel: "my-chan", content: "x" });
    expect(axis).toBe("channels/my-chan");
  });

  it("resolves scope.axis for tail mode", () => {
    const axis = (channelTool.scope.axis as Function)({ mode: "tail", channel: "my-chan" });
    expect(axis).toBe("channels/my-chan");
  });

  it("resolves scope.axis to channels/* when no channel provided", () => {
    const axis = (channelTool.scope.axis as Function)(null);
    expect(axis).toBe("channels/*");
  });
});
