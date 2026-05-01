import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
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

  it("appends a page entry to _index/pages.json from a journal file", async () => {
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
    await upsertPage(vaultPath, path);
    const idx = loadIndex(vaultPath);
    const found = idx.pages.find(p => p.id === "journal-2026-04-30-1000-x");
    expect(found).toBeDefined();
    expect(found?.channel).toBe("feat-x");
    expect(found?.type).toBe("journal");
  });

  it("replaces an existing entry when called with the same id", async () => {
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
    await upsertPage(vaultPath, path);

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
    await upsertPage(vaultPath, path);

    const idx = loadIndex(vaultPath);
    const matches = idx.pages.filter(p => p.id === "journal-2026-04-30-1000-x");
    expect(matches).toHaveLength(1);
    expect(matches[0].title).toBe("second title");
  });

  it("is a no-op (no throw) when the file does not exist", async () => {
    const path = join(vaultPath, "wikis", "alpha", "journal", "missing.md");
    await expect(upsertPage(vaultPath, path)).resolves.not.toThrow();
  });

  it("is a no-op (no throw) when the file has malformed frontmatter", async () => {
    const path = join(vaultPath, "wikis", "alpha", "journal", "bad.md");
    writeFileSync(path, "no frontmatter here, just body");
    await expect(upsertPage(vaultPath, path)).resolves.not.toThrow();
  });
});

describe("upsertPage — wikis.json write-through (v1.7 §5.1)", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-upsert-wikis-"));
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    mkdirSync(join(vaultPath, "wikis", "alpha", "journal"), { recursive: true });
    // Seed wikis.json with an empty alpha entry so write-through has something to mutate.
    writeFileSync(
      join(vaultPath, "_index", "wikis.json"),
      JSON.stringify({
        wikis: [{ name: "alpha", mode: "mixed", scope: "", page_counts: {}, last_touched: "2026-01-01T00:00:00.000Z" }]
      }, null, 2)
    );
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("increments page_counts[type] when a new page is upserted", async () => {
    const pagePath = join(vaultPath, "wikis", "alpha", "journal", "journal-2026-05-02-1200-test.md");
    writeFileSync(pagePath, [
      "---",
      "id: journal-2026-05-02-1200-test",
      "title: Test",
      "type: journal",
      "wiki: alpha",
      "created: '2026-05-02T12:00:00.000Z'",
      "---",
      "body"
    ].join("\n"));

    await upsertPage(vaultPath, pagePath);

    const wikisData = JSON.parse(readFileSync(join(vaultPath, "_index", "wikis.json"), "utf8"));
    const alpha = wikisData.wikis.find((w: any) => w.name === "alpha");
    expect(alpha.page_counts.journal).toBe(1);
  });

  it("updates last_touched to the page's updated/created timestamp", async () => {
    const pagePath = join(vaultPath, "wikis", "alpha", "journal", "journal-2026-05-02-1200-test.md");
    writeFileSync(pagePath, [
      "---",
      "id: journal-2026-05-02-1200-test",
      "title: Test",
      "type: journal",
      "wiki: alpha",
      "created: '2026-05-02T12:00:00.000Z'",
      "---",
      "body"
    ].join("\n"));

    await upsertPage(vaultPath, pagePath);

    const wikisData = JSON.parse(readFileSync(join(vaultPath, "_index", "wikis.json"), "utf8"));
    const alpha = wikisData.wikis.find((w: any) => w.name === "alpha");
    expect(alpha.last_touched).toBe("2026-05-02T12:00:00.000Z");
  });

  it("does not double-count when the same page is upserted twice", async () => {
    const pagePath = join(vaultPath, "wikis", "alpha", "journal", "journal-2026-05-02-1200-test.md");
    writeFileSync(pagePath, [
      "---",
      "id: journal-2026-05-02-1200-test",
      "title: Test",
      "type: journal",
      "wiki: alpha",
      "created: '2026-05-02T12:00:00.000Z'",
      "---",
      "body"
    ].join("\n"));

    await upsertPage(vaultPath, pagePath);
    await upsertPage(vaultPath, pagePath);

    const wikisData = JSON.parse(readFileSync(join(vaultPath, "_index", "wikis.json"), "utf8"));
    const alpha = wikisData.wikis.find((w: any) => w.name === "alpha");
    expect(alpha.page_counts.journal).toBe(1);
  });

  it("creates a wikis.json entry on-the-fly if the wiki is missing", async () => {
    mkdirSync(join(vaultPath, "wikis", "beta", "journal"), { recursive: true });
    const pagePath = join(vaultPath, "wikis", "beta", "journal", "journal-2026-05-02-1200-new.md");
    writeFileSync(pagePath, [
      "---",
      "id: journal-2026-05-02-1200-new",
      "title: Test",
      "type: journal",
      "wiki: beta",
      "created: '2026-05-02T12:00:00.000Z'",
      "---",
      "body"
    ].join("\n"));

    await upsertPage(vaultPath, pagePath);

    const wikisData = JSON.parse(readFileSync(join(vaultPath, "_index", "wikis.json"), "utf8"));
    const beta = wikisData.wikis.find((w: any) => w.name === "beta");
    expect(beta).toBeDefined();
    expect(beta.page_counts.journal).toBe(1);
  });

  it("preserves the families rollup when upserting", async () => {
    // Seed wikis.json with a families rollup (v1.6 Phase-2 T2-2 shape).
    writeFileSync(
      join(vaultPath, "_index", "wikis.json"),
      JSON.stringify({
        wikis: [{ name: "alpha", mode: "mixed", scope: "", page_counts: {}, last_touched: "2026-01-01T00:00:00.000Z" }],
        families: {
          rastate: {
            family: "rastate",
            members: ["rastate-core", "rastate-dev"],
            total_pages: 0,
            modes_used: ["project-doc"]
          }
        }
      }, null, 2)
    );

    const pagePath = join(vaultPath, "wikis", "alpha", "journal", "journal-2026-05-02-1200-test.md");
    writeFileSync(pagePath, [
      "---",
      "id: journal-2026-05-02-1200-test",
      "title: Test",
      "type: journal",
      "wiki: alpha",
      "created: '2026-05-02T12:00:00.000Z'",
      "---",
      "body"
    ].join("\n"));

    await upsertPage(vaultPath, pagePath);

    const wikisData = JSON.parse(readFileSync(join(vaultPath, "_index", "wikis.json"), "utf8"));
    expect(wikisData.families).toBeDefined();
    expect(wikisData.families.rastate.family).toBe("rastate");
    expect(wikisData.families.rastate.members).toEqual(["rastate-core", "rastate-dev"]);
  });
});

describe("upsertPage — concurrent RMW serialization (v1.7 §5.2)", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-upsert-conc-"));
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    mkdirSync(join(vaultPath, "wikis", "alpha", "journal"), { recursive: true });
    writeFileSync(join(vaultPath, "_index", "pages.json"), JSON.stringify({ pages: [] }));
    writeFileSync(join(vaultPath, "_index", "tokens.json"), JSON.stringify({}));
    writeFileSync(join(vaultPath, "_index", "wikis.json"), JSON.stringify({
      wikis: [{ name: "alpha", mode: "mixed", scope: "", page_counts: {}, last_touched: "" }]
    }));
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("preserves all 10 concurrent upserts (no lost writes)", async () => {
    const writes = Array.from({ length: 10 }, (_, i) => {
      const id = `journal-2026-05-02-${String(i).padStart(4, "0")}-conc`;
      const path = join(vaultPath, "wikis", "alpha", "journal", `${id}.md`);
      writeFileSync(path, [
        "---",
        `id: ${id}`,
        "title: Conc",
        "type: journal",
        "wiki: alpha",
        `created: '2026-05-02T12:00:${String(i).padStart(2, "0")}.000Z'`,
        "---",
        "body"
      ].join("\n"));
      return path;
    });

    await Promise.all(writes.map(p => Promise.resolve().then(() => upsertPage(vaultPath, p))));

    const pagesData = JSON.parse(readFileSync(join(vaultPath, "_index", "pages.json"), "utf8"));
    expect(pagesData.pages).toHaveLength(10);
    const ids = new Set(pagesData.pages.map((p: any) => p.id));
    expect(ids.size).toBe(10);
  });
});
