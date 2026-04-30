import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { upsertPage, loadIndex } from "../../src/core/index.js";

describe("upsertPage", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-upsert-"));
    mkdirSync(join(vaultPath, "wikis", "alpha", "journal"), { recursive: true });
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    writeFileSync(join(vaultPath, "_index", "pages.json"), JSON.stringify({ pages: [] }, null, 2));
    writeFileSync(join(vaultPath, "_index", "tokens.json"), "{}");
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("appends a page entry to _index/pages.json from a journal file", () => {
    const path = join(vaultPath, "wikis", "alpha", "journal", "journal-2026-04-30-1000-x.md");
    writeFileSync(path,
      `---
id: journal-2026-04-30-1000-x
title: "x"
type: journal
wiki: alpha
created: 2026-04-30T10:00:00Z
author: agent:charmander
channel: feat-x
---
body
`);
    upsertPage(vaultPath, path);
    const idx = loadIndex(vaultPath);
    const found = idx.pages.find(p => p.id === "journal-2026-04-30-1000-x");
    expect(found).toBeDefined();
    expect(found?.channel).toBe("feat-x");
    expect(found?.type).toBe("journal");
  });

  it("replaces an existing entry when called with the same id", () => {
    const path = join(vaultPath, "wikis", "alpha", "journal", "journal-2026-04-30-1000-x.md");
    writeFileSync(path,
      `---
id: journal-2026-04-30-1000-x
title: "first title"
type: journal
wiki: alpha
created: 2026-04-30T10:00:00Z
---
first body
`);
    upsertPage(vaultPath, path);

    writeFileSync(path,
      `---
id: journal-2026-04-30-1000-x
title: "second title"
type: journal
wiki: alpha
created: 2026-04-30T10:00:00Z
---
second body
`);
    upsertPage(vaultPath, path);

    const idx = loadIndex(vaultPath);
    const matches = idx.pages.filter(p => p.id === "journal-2026-04-30-1000-x");
    expect(matches).toHaveLength(1);
    expect(matches[0].title).toBe("second title");
  });

  it("is a no-op (no throw) when the file does not exist", () => {
    const path = join(vaultPath, "wikis", "alpha", "journal", "missing.md");
    expect(() => upsertPage(vaultPath, path)).not.toThrow();
  });

  it("is a no-op (no throw) when the file has malformed frontmatter", () => {
    const path = join(vaultPath, "wikis", "alpha", "journal", "bad.md");
    writeFileSync(path, "no frontmatter here, just body");
    expect(() => upsertPage(vaultPath, path)).not.toThrow();
  });
});
