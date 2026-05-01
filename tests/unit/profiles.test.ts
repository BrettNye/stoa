import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readProfile, writeProfile, listProfiles, getMoveset, renameProfile,
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

  describe("readProfile alias overlay (T2-1)", () => {
    beforeEach(() => {
      // Seed: write profile-charmander, then rename to profile-charmeleon.
      // After rename, alias index records charmander → charmeleon (current).
      writeProfile(vaultPath, {
        id: "profile-charmander",
        title: "Charmander",
        pokemon_type: "fire",
        evolution_stage: "basic",
        moveset: ["move-tdd-cycle"],
        summary: "Backend Pokemon"
      });
      renameProfile(vaultPath, "profile-charmander", "profile-charmeleon");
    });

    it("Case A: bare-name historical id resolves via alias overlay", () => {
      // "charmander" — no file at profiles/charmander.md, no file at
      // profiles/profile-charmander.md (renamed), but alias index has
      // profile-charmander → profile-charmeleon.
      const p = readProfile(vaultPath, "charmander");
      expect(p.frontmatter.id).toBe("profile-charmeleon");
      expect(p.frontmatter.pokemon_type).toBe("fire");
    });

    it("Case B: profile-<old> historical id resolves via alias overlay", () => {
      const p = readProfile(vaultPath, "profile-charmander");
      expect(p.frontmatter.id).toBe("profile-charmeleon");
    });

    it("Case C: current id resolves directly (regression)", () => {
      const p = readProfile(vaultPath, "profile-charmeleon");
      expect(p.frontmatter.id).toBe("profile-charmeleon");
    });

    it("Case D: bare-name current id resolves via existing normalization", () => {
      const p = readProfile(vaultPath, "charmeleon");
      expect(p.frontmatter.id).toBe("profile-charmeleon");
    });

    it("Case E: unknown id with no alias entry throws ProfileNotFoundError", () => {
      expect(() => readProfile(vaultPath, "mewtwo")).toThrow(ProfileNotFoundError);
      expect(() => readProfile(vaultPath, "profile-mewtwo")).toThrow(ProfileNotFoundError);
    });
  });
});
