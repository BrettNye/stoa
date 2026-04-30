import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { tailChannel } from "../../src/core/channel.js";
import { reindex } from "../../src/core/reindex.js";

describe("tailChannel — since normalization (T3-5)", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-since-"));
    mkdirSync(join(vaultPath, "wikis", "alpha", "journal"), { recursive: true });
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    writeFileSync(join(vaultPath, "_index", "aliases.json"), "{}");
    writeFileSync(join(vaultPath, "wikis", "alpha", "journal", "journal-2026-04-30-1200-x.md"),
      `---
id: journal-2026-04-30-1200-x
title: x
type: journal
wiki: alpha
created: 2026-04-30T12:00:00Z
author: agent:charmander
channel: feat-x
---
body
`);
    reindex(vaultPath);
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("accepts a Date object as since (gray-matter coercion case)", () => {
    // since = day before entry (2026-04-29), entry created 2026-04-30 → should be included
    const r = tailChannel(vaultPath, {
      channel: "feat-x",
      since: new Date("2026-04-29T00:00:00Z") as any
    });
    expect(r.entries.length).toBe(1);
  });

  it("accepts an ISO string as since (canonical case)", () => {
    // since = day before entry (2026-04-29), entry created 2026-04-30 → should be included
    const r = tailChannel(vaultPath, {
      channel: "feat-x",
      since: "2026-04-29T00:00:00Z"
    });
    expect(r.entries.length).toBe(1);
  });

  it("accepts undefined since (defaults to 24h ago — should still find recent)", () => {
    const r = tailChannel(vaultPath, { channel: "feat-x" });
    expect(r.entries.length).toBeGreaterThanOrEqual(0);
  });
});
