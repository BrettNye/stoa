import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readProfile, writeProfile, listProfiles, getMoveset,
  ProfileNotFoundError
} from "../../src/core/profiles.js";

describe("profiles", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-profiles-"));
    mkdirSync(join(vaultPath, "wikis", "_agents", "profiles"), { recursive: true });
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("writeProfile then readProfile round-trips", () => {
    writeProfile(vaultPath, {
      id: "profile-charmander",
      title: "Charmander",
      pokemon_type: "fire",
      evolution_stage: "basic",
      moveset: ["move-tdd-cycle", "move-pr-create"],
      summary: "Backend Pokemon"
    });
    const p = readProfile(vaultPath, "profile-charmander");
    expect(p.frontmatter.pokemon_type).toBe("fire");
    expect(p.frontmatter.moveset).toEqual(["move-tdd-cycle", "move-pr-create"]);
  });

  it("readProfile throws ProfileNotFoundError for missing profile", () => {
    expect(() => readProfile(vaultPath, "profile-mewtwo")).toThrow(ProfileNotFoundError);
  });

  it("listProfiles returns all profiles", () => {
    writeProfile(vaultPath, {
      id: "profile-charmander", title: "Charmander", pokemon_type: "fire",
      evolution_stage: "basic", moveset: [], summary: "x"
    });
    writeProfile(vaultPath, {
      id: "profile-squirtle", title: "Squirtle", pokemon_type: "water",
      evolution_stage: "basic", moveset: [], summary: "y"
    });
    const profiles = listProfiles(vaultPath);
    expect(profiles.map(p => p.id).sort()).toEqual(["profile-charmander", "profile-squirtle"]);
  });

  it("getMoveset returns the moveset array from a profile", () => {
    writeProfile(vaultPath, {
      id: "profile-charmander", title: "Charmander", pokemon_type: "fire",
      evolution_stage: "basic", moveset: ["move-a", "move-b"], summary: "x"
    });
    expect(getMoveset(vaultPath, "profile-charmander")).toEqual(["move-a", "move-b"]);
  });
});
