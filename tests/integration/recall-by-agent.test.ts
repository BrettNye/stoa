import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { recall } from "../../src/core/recall.js";
import { reindex } from "../../src/core/reindex.js";
import { recordRename } from "../../src/core/aliases.js";

describe("recall — by_agent filter (alias-aware)", () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-rba-"));
    mkdirSync(join(vaultPath, "wikis", "alpha", "journal"), { recursive: true });
    mkdirSync(join(vaultPath, "_index"), { recursive: true });

    writeFileSync(join(vaultPath, "wikis", "alpha", "journal", "journal-2026-04-29-1000-x.md"),
      `---
id: journal-2026-04-29-1000-x
title: Journal x feature work
type: journal
wiki: alpha
created: 2026-04-29T10:00:00Z
author: agent:charmander
---
journal x body — feature work
`);
    writeFileSync(join(vaultPath, "wikis", "alpha", "journal", "journal-2026-04-29-1100-y.md"),
      `---
id: journal-2026-04-29-1100-y
title: Journal y feature work
type: journal
wiki: alpha
created: 2026-04-29T11:00:00Z
author: agent:squirtle
---
journal y body — feature work
`);
    await reindex(vaultPath);
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("by_agent filters hits to that agent's authored pages", () => {
    const r = recall(vaultPath, { topic: "feature work", by_agent: "charmander", layer: "all" });
    expect(r.hits.map(h => h.id)).toContain("journal-2026-04-29-1000-x");
    expect(r.hits.map(h => h.id)).not.toContain("journal-2026-04-29-1100-y");
  });

  it("by_agent expands historical aliases (charmeleon finds charmander work)", () => {
    recordRename(vaultPath, "profile-charmander", "profile-charmeleon");
    const r = recall(vaultPath, { topic: "feature work", by_agent: "charmeleon", layer: "all" });
    expect(r.hits.map(h => h.id)).toContain("journal-2026-04-29-1000-x");
  });

  it("without by_agent, all matching authors are returned", () => {
    const r = recall(vaultPath, { topic: "feature work", layer: "all" });
    expect(r.hits.length).toBeGreaterThanOrEqual(2);
  });
});
