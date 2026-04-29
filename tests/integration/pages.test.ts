import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPage, writePage, ConflictError, PageNotFoundError } from "../../src/core/pages.js";

let vault: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-pages-"));
  mkdirSync(join(vault, "wikis", "alpha", "concepts"), { recursive: true });
  writeFileSync(
    join(vault, "wikis", "alpha", "concepts", "concept-foo.md"),
    `---
id: concept-foo
title: "Foo"
type: concept
wiki: alpha
status: draft
created: 2026-04-28
updated: 2026-04-28
summary: "Foo concept"
---
Body content here.
`
  );
});

describe("readPage", () => {
  it("returns frontmatter, body, updated, path", () => {
    const page = readPage(vault, "concept-foo", "alpha");
    expect(page.frontmatter.id).toBe("concept-foo");
    expect(page.frontmatter.type).toBe("concept");
    expect(page.body.trim()).toBe("Body content here.");
    expect(page.updated).toBe("2026-04-28");
    expect(page.path).toContain("concept-foo.md");
  });

  it("throws PageNotFoundError when id missing", () => {
    expect(() => readPage(vault, "concept-missing", "alpha"))
      .toThrow(PageNotFoundError);
  });
});

describe("writePage", () => {
  it("creates new page on first write", () => {
    const result = writePage(vault, {
      id: "concept-bar",
      type: "concept",
      wiki: "alpha",
      frontmatter: { id: "concept-bar", title: "Bar", type: "concept", created: "2026-04-28", wiki: "alpha", status: "draft" },
      body: "New page."
    });
    expect(result.id).toBe("concept-bar");
    expect(result.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const reread = readPage(vault, "concept-bar", "alpha");
    expect(reread.body.trim()).toBe("New page.");
  });

  it("updates existing page when expectedUpdated matches", () => {
    const result = writePage(vault, {
      id: "concept-foo",
      type: "concept",
      wiki: "alpha",
      frontmatter: { id: "concept-foo", title: "Foo!", type: "concept", created: "2026-04-28", wiki: "alpha", status: "active", summary: "x", updated: "ignored" },
      body: "Edited.",
      expectedUpdated: "2026-04-28"
    });
    const reread = readPage(vault, "concept-foo", "alpha");
    expect(reread.frontmatter.title).toBe("Foo!");
    expect(reread.body.trim()).toBe("Edited.");
  });

  it("throws ConflictError when expectedUpdated mismatches", () => {
    expect(() => writePage(vault, {
      id: "concept-foo",
      type: "concept",
      wiki: "alpha",
      frontmatter: { id: "concept-foo", title: "Foo", type: "concept", created: "2026-04-28", wiki: "alpha", status: "draft" },
      body: "x",
      expectedUpdated: "1999-01-01"
    })).toThrow(ConflictError);
  });

  it("idempotent re-write with same content + matching updated still succeeds", () => {
    const r1 = writePage(vault, {
      id: "concept-foo",
      type: "concept",
      wiki: "alpha",
      frontmatter: { id: "concept-foo", title: "Foo", type: "concept", created: "2026-04-28", wiki: "alpha", status: "draft" },
      body: "v1",
      expectedUpdated: "2026-04-28"
    });
    const r2 = writePage(vault, {
      id: "concept-foo",
      type: "concept",
      wiki: "alpha",
      frontmatter: { id: "concept-foo", title: "Foo", type: "concept", created: "2026-04-28", wiki: "alpha", status: "draft" },
      body: "v2",
      expectedUpdated: r1.updated
    });
    expect(r2.id).toBe("concept-foo");
  });
});

describe("concurrency", () => {
  it("two competing writes: one wins, one throws ConflictError", async () => {
    const baseUpdated = "2026-04-28";
    const w1 = () => writePage(vault, {
      id: "concept-foo", type: "concept", wiki: "alpha",
      frontmatter: { id: "concept-foo", title: "A", type: "concept", created: "2026-04-28", wiki: "alpha", status: "draft" },
      body: "writer-1", expectedUpdated: baseUpdated
    });
    // First write succeeds and bumps updated to today
    const r1 = w1();
    // Second write with the original baseUpdated should now conflict
    expect(() => writePage(vault, {
      id: "concept-foo", type: "concept", wiki: "alpha",
      frontmatter: { id: "concept-foo", title: "B", type: "concept", created: "2026-04-28", wiki: "alpha", status: "draft" },
      body: "writer-2", expectedUpdated: baseUpdated
    })).toThrow(ConflictError);
  });
});
