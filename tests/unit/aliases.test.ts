import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readAliases, recordRename, expandAliases, resolveCurrent
} from "../../src/core/aliases.js";

describe("aliases", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-aliases-"));
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("readAliases returns empty when file does not exist", () => {
    const aliases = readAliases(vaultPath);
    expect(aliases).toEqual({});
  });

  it("recordRename writes the rename pair", () => {
    recordRename(vaultPath, "profile-charmander", "profile-charmeleon");
    const a = readAliases(vaultPath);
    expect(a["profile-charmander"].current).toBe("profile-charmeleon");
    expect(a["profile-charmander"].history).toEqual(["profile-charmander"]);
  });

  it("recordRename preserves history across multiple renames", () => {
    recordRename(vaultPath, "profile-charmander", "profile-charmeleon");
    recordRename(vaultPath, "profile-charmeleon", "profile-charizard");
    const a = readAliases(vaultPath);
    expect(a["profile-charmander"].current).toBe("profile-charizard");
    expect(a["profile-charmander"].history).toEqual(["profile-charmander", "profile-charmeleon"]);
    expect(a["profile-charmeleon"].current).toBe("profile-charizard");
  });

  it("expandAliases returns all historical ids for a current id", () => {
    recordRename(vaultPath, "profile-charmander", "profile-charmeleon");
    recordRename(vaultPath, "profile-charmeleon", "profile-charizard");
    const all = expandAliases(vaultPath, "profile-charizard");
    expect(all.sort()).toEqual(["profile-charizard", "profile-charmander", "profile-charmeleon"]);
  });

  it("expandAliases on an unknown id returns just that id", () => {
    const all = expandAliases(vaultPath, "profile-mewtwo");
    expect(all).toEqual(["profile-mewtwo"]);
  });

  it("resolveCurrent returns the current id given any historical id", () => {
    recordRename(vaultPath, "profile-charmander", "profile-charmeleon");
    expect(resolveCurrent(vaultPath, "profile-charmander")).toBe("profile-charmeleon");
    expect(resolveCurrent(vaultPath, "profile-charmeleon")).toBe("profile-charmeleon");
  });
});
