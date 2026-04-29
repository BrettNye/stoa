import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { recordRename, expandAliases, resolveCurrent } from "../../src/core/aliases.js";

describe("integration — aliases through evolution chain", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-int-aliases-"));
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("traces a 3-stage chain Charmander→Charmeleon→Charizard", () => {
    recordRename(vaultPath, "profile-charmander", "profile-charmeleon");
    recordRename(vaultPath, "profile-charmeleon", "profile-charizard");

    expect(resolveCurrent(vaultPath, "profile-charmander")).toBe("profile-charizard");
    expect(resolveCurrent(vaultPath, "profile-charmeleon")).toBe("profile-charizard");
    expect(resolveCurrent(vaultPath, "profile-charizard")).toBe("profile-charizard");

    const all = expandAliases(vaultPath, "profile-charizard");
    expect(all.sort()).toEqual([
      "profile-charizard", "profile-charmander", "profile-charmeleon"
    ]);
  });
});
