import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeProfile, readProfile, listProfiles } from "../../src/core/profiles.js";

describe("integration — profiles round-trip", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-int-profiles-"));
    mkdirSync(join(vaultPath, "wikis", "_agents", "profiles"), { recursive: true });
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("create → list → read produces consistent state", () => {
    writeProfile(vaultPath, {
      id: "profile-charmander",
      title: "Charmander",
      pokemon_type: "fire",
      evolution_stage: "basic",
      moveset: ["move-tdd-cycle"],
      summary: "Backend"
    });
    writeProfile(vaultPath, {
      id: "profile-squirtle",
      title: "Squirtle",
      pokemon_type: "water",
      evolution_stage: "basic",
      moveset: [],
      summary: "Frontend"
    });

    const list = listProfiles(vaultPath);
    expect(list.map(p => p.id).sort()).toEqual(["profile-charmander", "profile-squirtle"]);

    const charm = readProfile(vaultPath, "profile-charmander");
    expect(charm.frontmatter.pokemon_type).toBe("fire");
    expect(charm.frontmatter.moveset).toEqual(["move-tdd-cycle"]);
  });
});
