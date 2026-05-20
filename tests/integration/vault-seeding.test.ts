import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedVault } from "../../src/core/vault-seeding.js";

it("creates wiki structure and inbox items", () => {
  const v = mkdtempSync(join(tmpdir(), "vault-"));
  seedVault({ vault_path: v, wiki_names: ["meetings"], inbox_items: ["remember our pricing rationale"] });
  expect(existsSync(join(v, "wikis", "meetings", "map.md"))).toBe(true);
  expect(existsSync(join(v, "wikis", "meetings", "inbox"))).toBe(true);
});

describe("seedVault", () => {
  it("creates all 10 type subdirectories per wiki", () => {
    const v = mkdtempSync(join(tmpdir(), "vault-"));
    seedVault({ vault_path: v, wiki_names: ["notes"], inbox_items: [] });
    const expectedDirs = ["inbox", "concept", "synthesis", "idea", "question", "decision", "source", "guide", "journal", "task"];
    for (const dir of expectedDirs) {
      expect(existsSync(join(v, "wikis", "notes", dir))).toBe(true);
    }
  });

  it("writes map.md with valid frontmatter", () => {
    const v = mkdtempSync(join(tmpdir(), "vault-"));
    seedVault({ vault_path: v, wiki_names: ["work"], inbox_items: [] });
    const mapContent = readFileSync(join(v, "wikis", "work", "map.md"), "utf8");
    expect(mapContent).toMatch(/type: map/);
    expect(mapContent).toMatch(/status: active/);
    expect(mapContent).toMatch(/created: \d{4}-\d{2}-\d{2}/);
    expect(mapContent).toMatch(/wiki: work/);
  });

  it("writes index.md for each wiki", () => {
    const v = mkdtempSync(join(tmpdir(), "vault-"));
    seedVault({ vault_path: v, wiki_names: ["notes"], inbox_items: [] });
    expect(existsSync(join(v, "wikis", "notes", "index.md"))).toBe(true);
  });

  it("writes one inbox file per inbox item in first wiki only", () => {
    const v = mkdtempSync(join(tmpdir(), "vault-"));
    seedVault({
      vault_path: v,
      wiki_names: ["alpha", "beta"],
      inbox_items: ["first thought", "second thought"],
    });
    const alphaInbox = readdirSync(join(v, "wikis", "alpha", "inbox"));
    const betaInbox = readdirSync(join(v, "wikis", "beta", "inbox"));
    expect(alphaInbox).toHaveLength(2);
    expect(betaInbox).toHaveLength(0);
  });

  it("inbox files contain the item text and frontmatter", () => {
    const v = mkdtempSync(join(tmpdir(), "vault-"));
    seedVault({
      vault_path: v,
      wiki_names: ["notes"],
      inbox_items: ["remember our pricing rationale"],
    });
    const files = readdirSync(join(v, "wikis", "notes", "inbox"));
    expect(files).toHaveLength(1);
    const content = readFileSync(join(v, "wikis", "notes", "inbox", files[0]), "utf8");
    expect(content).toContain("remember our pricing rationale");
    expect(content).toMatch(/created: \d{4}-\d{2}-\d{2}/);
  });

  it("inbox filename is slug-derived from item text", () => {
    const v = mkdtempSync(join(tmpdir(), "vault-"));
    const today = new Date().toISOString().slice(0, 10);
    seedVault({
      vault_path: v,
      wiki_names: ["notes"],
      inbox_items: ["remember our pricing rationale"],
    });
    const files = readdirSync(join(v, "wikis", "notes", "inbox"));
    expect(files[0]).toMatch(new RegExp(`^${today}-01-remember-our-pricing-rationale`));
  });

  it("is idempotent — does not overwrite existing map.md or index.md", () => {
    const v = mkdtempSync(join(tmpdir(), "vault-"));
    seedVault({ vault_path: v, wiki_names: ["notes"], inbox_items: [] });
    const mapContentBefore = readFileSync(join(v, "wikis", "notes", "map.md"), "utf8");
    const idxContentBefore = readFileSync(join(v, "wikis", "notes", "index.md"), "utf8");
    seedVault({ vault_path: v, wiki_names: ["notes"], inbox_items: [] });
    const mapContentAfter = readFileSync(join(v, "wikis", "notes", "map.md"), "utf8");
    const idxContentAfter = readFileSync(join(v, "wikis", "notes", "index.md"), "utf8");
    expect(mapContentAfter).toBe(mapContentBefore);
    expect(idxContentAfter).toBe(idxContentBefore);
  });

  it("handles multiple wikis creating structure for each", () => {
    const v = mkdtempSync(join(tmpdir(), "vault-"));
    seedVault({ vault_path: v, wiki_names: ["wiki1", "wiki2", "wiki3"], inbox_items: [] });
    for (const wiki of ["wiki1", "wiki2", "wiki3"]) {
      expect(existsSync(join(v, "wikis", wiki, "map.md"))).toBe(true);
      expect(existsSync(join(v, "wikis", wiki, "inbox"))).toBe(true);
    }
  });

  it("does nothing when wiki_names is empty", () => {
    const v = mkdtempSync(join(tmpdir(), "vault-"));
    expect(() => seedVault({ vault_path: v, wiki_names: [], inbox_items: ["item"] })).not.toThrow();
    expect(existsSync(join(v, "wikis"))).toBe(false);
  });
});
