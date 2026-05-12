import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { enumerateProfilesForSync } from "../../src/core/sync-enumerate.js";

function writeProfile(vaultPath: string, id: string, pokemon_type: string, secondary?: string) {
  const profilesDir = join(vaultPath, "wikis", "_agents", "profiles");
  mkdirSync(profilesDir, { recursive: true });
  const sec = secondary ? `\nsecondary_pokemon_type: ${secondary}` : "";
  writeFileSync(join(profilesDir, `${id}.md`),
    `---
id: ${id}
type: profile
title: ${id}
created: 2026-05-12
wiki: _agents
status: active
summary: x
pokemon_type: ${pokemon_type}${sec}
evolution_stage: basic
moveset: []
applies_to: [claude-code]
---
# ${id}
`);
}

describe("enumerateProfilesForSync", () => {
  let vaultPath: string;
  beforeEach(() => { vaultPath = mkdtempSync(join(tmpdir(), "vault-enum-")); });
  afterEach(() => { rmSync(vaultPath, { recursive: true, force: true }); });

  it("returns all profile ids when no filters applied", () => {
    writeProfile(vaultPath, "profile-squirtle", "water");
    writeProfile(vaultPath, "profile-charmander", "fire");
    const result = enumerateProfilesForSync(vaultPath, { exclude: [], pokemon_type: [] });
    expect(result.sort()).toEqual(["profile-charmander", "profile-squirtle"]);
  });

  it("filters by pokemon_type (primary)", () => {
    writeProfile(vaultPath, "profile-squirtle", "water");
    writeProfile(vaultPath, "profile-charmander", "fire");
    const result = enumerateProfilesForSync(vaultPath, { exclude: [], pokemon_type: ["water"] });
    expect(result).toEqual(["profile-squirtle"]);
  });

  it("filters by pokemon_type (secondary type matches too)", () => {
    writeProfile(vaultPath, "profile-mew", "psychic", "water");
    writeProfile(vaultPath, "profile-charmander", "fire");
    const result = enumerateProfilesForSync(vaultPath, { exclude: [], pokemon_type: ["water"] });
    expect(result).toEqual(["profile-mew"]);
  });

  it("excludes by id (alias-aware)", () => {
    writeProfile(vaultPath, "profile-squirtle", "water");
    writeProfile(vaultPath, "profile-charmander", "fire");
    const result = enumerateProfilesForSync(vaultPath, { exclude: ["profile-squirtle"], pokemon_type: [] });
    expect(result).toEqual(["profile-charmander"]);
  });

  it("exclude accepts bare slugs (without profile- prefix)", () => {
    writeProfile(vaultPath, "profile-squirtle", "water");
    const result = enumerateProfilesForSync(vaultPath, { exclude: ["squirtle"], pokemon_type: [] });
    expect(result).toEqual([]);
  });

  it("returns [] when profiles dir is missing", () => {
    expect(enumerateProfilesForSync(vaultPath, { exclude: [], pokemon_type: [] })).toEqual([]);
  });

  it("returns sorted ids for stable output", () => {
    writeProfile(vaultPath, "profile-zapdos", "electric");
    writeProfile(vaultPath, "profile-articuno", "ice");
    writeProfile(vaultPath, "profile-moltres", "fire");
    const result = enumerateProfilesForSync(vaultPath, { exclude: [], pokemon_type: [] });
    expect(result).toEqual(["profile-articuno", "profile-moltres", "profile-zapdos"]);
  });
});
