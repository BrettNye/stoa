import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { initVault } from "../../src/cli/commands/init.js";

describe("stoa init (unit)", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "stoa-init-u-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("refuses to init into a non-empty dir without --force", async () => {
    const target = join(workDir, "vault");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "leftover.txt"), "x\n");

    await expect(initVault({ vaultPath: target, force: false })).rejects.toThrow(
      /not empty|--force/i
    );
  });

  it("init with --force on non-empty dir succeeds", async () => {
    const target = join(workDir, "vault");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "leftover.txt"), "x\n");

    const r = await initVault({ vaultPath: target, force: true });
    expect(r.vaultPath).toBe(resolve(target));
    expect(existsSync(join(target, ".active-wiki"))).toBe(true);
  });

  it("resolves relative paths to absolute", async () => {
    const rel = "rel-vault-" + Date.now();
    const target = join(workDir, rel);
    const r = await initVault({ vaultPath: target, force: false });
    expect(isAbsolute(r.vaultPath)).toBe(true);
    expect(r.vaultPath).toBe(resolve(target));
  });

  it("errors out when parent dir does not exist", async () => {
    const target = join(workDir, "missing-parent", "vault");
    await expect(initVault({ vaultPath: target, force: false })).rejects.toThrow(
      /parent.*not exist|parent directory/i
    );
  });

  it("creates _index/*.json stubs with the expected shape", async () => {
    const target = join(workDir, "vault");
    await initVault({ vaultPath: target, force: false });

    const pagesPath = join(target, "_index", "pages.json");
    const wikisPath = join(target, "_index", "wikis.json");
    const tokensPath = join(target, "_index", "tokens.json");
    const linksPath = join(target, "_index", "links.json");

    expect(existsSync(pagesPath)).toBe(true);
    expect(existsSync(wikisPath)).toBe(true);
    expect(existsSync(tokensPath)).toBe(true);
    expect(existsSync(linksPath)).toBe(true);

    const pages = JSON.parse(readFileSync(pagesPath, "utf8"));
    const wikis = JSON.parse(readFileSync(wikisPath, "utf8"));
    expect(Array.isArray(pages.pages)).toBe(true);
    expect(Array.isArray(wikis.wikis)).toBe(true);
  });

  it("without --with-wiki, .active-wiki is empty", async () => {
    const target = join(workDir, "vault");
    await initVault({ vaultPath: target, force: false });
    const activeWiki = readFileSync(join(target, ".active-wiki"), "utf8").trim();
    expect(activeWiki).toBe("");
  });

  it("with --with-wiki, .active-wiki contains that wiki's name", async () => {
    const target = join(workDir, "vault");
    await initVault({ vaultPath: target, force: false, withWiki: "notes", mode: "idea-map" });
    const activeWiki = readFileSync(join(target, ".active-wiki"), "utf8").trim();
    expect(activeWiki).toBe("notes");
    expect(existsSync(join(target, "wikis", "notes", "map.md"))).toBe(true);
  });

  it("creates wikis/ directory", async () => {
    const target = join(workDir, "vault");
    await initVault({ vaultPath: target, force: false });
    expect(existsSync(join(target, "wikis"))).toBe(true);
  });

  it("seeds wikis/_agents/ from bundled seed", async () => {
    const target = join(workDir, "vault");
    await initVault({ vaultPath: target, force: false });
    expect(existsSync(join(target, "wikis", "_agents"))).toBe(true);
    expect(existsSync(join(target, "wikis", "_agents", "README.md"))).toBe(true);
    // At least one profile + one move
    const profiles = readdirSync(join(target, "wikis", "_agents", "profiles"));
    expect(profiles.length).toBeGreaterThan(0);
  });

  it("returns a summary including the vault path and what was created", async () => {
    const target = join(workDir, "vault");
    const r = await initVault({ vaultPath: target, force: false });
    expect(r.vaultPath).toBe(resolve(target));
    expect(r.filesCreated.length).toBeGreaterThan(0);
    expect(r.wikisCreated).toContain("_agents");
  });

  it("with --with-wiki, wikisCreated includes the content wiki", async () => {
    const target = join(workDir, "vault");
    const r = await initVault({ vaultPath: target, force: false, withWiki: "notes", mode: "idea-map" });
    expect(r.wikisCreated).toContain("_agents");
    expect(r.wikisCreated).toContain("notes");
  });

  it("refuses init on a missing parent before any side-effects", async () => {
    const target = join(workDir, "no-parent-dir", "vault");
    await expect(initVault({ vaultPath: target, force: false })).rejects.toThrow();
    // Parent shouldn't have been created
    expect(existsSync(join(workDir, "no-parent-dir"))).toBe(false);
  });

  it("init on an empty existing dir succeeds (treated as empty)", async () => {
    const target = join(workDir, "vault");
    mkdirSync(target, { recursive: true });
    // empty - no entries
    const r = await initVault({ vaultPath: target, force: false });
    expect(r.vaultPath).toBe(resolve(target));
  });
});
