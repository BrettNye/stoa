import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { postToChannel, tailChannel } from "../../src/core/channel.js";
import { reindex } from "../../src/core/reindex.js";

describe("channel write-through (T2-1 fix)", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-cwt-"));
    mkdirSync(join(vaultPath, "wikis", "alpha", "journal"), { recursive: true });
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    writeFileSync(join(vaultPath, "_index", "aliases.json"), "{}");
    reindex(vaultPath);
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("postToChannel makes the entry immediately visible to tailChannel — no manual reindex needed", async () => {
    await postToChannel(vaultPath, { channel: "feat-x", content: "first", wiki: "alpha", agent_id: "charmander" });
    const r = tailChannel(vaultPath, { channel: "feat-x", since: "2026-01-01" });
    expect(r.entries.length).toBe(1);
    expect(r.entries[0].body).toContain("first");
  });

  it("two consecutive posts both visible without reindex", async () => {
    await postToChannel(vaultPath, { channel: "feat-x", content: "first", wiki: "alpha", agent_id: "charmander" });
    await postToChannel(vaultPath, { channel: "feat-x", content: "second", wiki: "alpha", agent_id: "charmander" });
    const r = tailChannel(vaultPath, { channel: "feat-x", since: "2026-01-01" });
    expect(r.entries.length).toBe(2);
  });
});
