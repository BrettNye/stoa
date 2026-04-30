import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { renameProfile } from "../../src/core/profiles.js";
import { readAliases } from "../../src/core/aliases.js";
import { parseFrontmatter } from "../../src/core/frontmatter.js";

describe("renameProfile", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-rename-"));
    const profilesDir = join(vaultPath, "wikis", "_agents", "profiles");
    mkdirSync(profilesDir, { recursive: true });
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    writeFileSync(join(profilesDir, "profile-charmander.md"),
      `---
id: profile-charmander
title: Charmander
type: profile
wiki: _agents
status: active
created: 2026-04-29
updated: 2026-04-29
summary: Backend specialist
pokemon_type: fire
evolution_stage: basic
autonomy_level: restricted
moveset: [move-tdd-cycle]
applies_to: [claude-code]
---

# Charmander
`);
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("writes a new profile file at the new id and deletes the old one", () => {
    renameProfile(vaultPath, "profile-charmander", "profile-charmeleon");
    const oldPath = join(vaultPath, "wikis", "_agents", "profiles", "profile-charmander.md");
    const newPath = join(vaultPath, "wikis", "_agents", "profiles", "profile-charmeleon.md");
    expect(existsSync(oldPath)).toBe(false);
    expect(existsSync(newPath)).toBe(true);
  });

  it("populates previous_names on the new profile and updates the id field", () => {
    renameProfile(vaultPath, "profile-charmander", "profile-charmeleon");
    const newPath = join(vaultPath, "wikis", "_agents", "profiles", "profile-charmeleon.md");
    const { frontmatter } = parseFrontmatter(readFileSync(newPath, "utf8"));
    expect(frontmatter.id).toBe("profile-charmeleon");
    expect(frontmatter.previous_names).toEqual(["profile-charmander"]);
  });

  it("records the rename in _index/aliases.json via aliases.recordRename", () => {
    renameProfile(vaultPath, "profile-charmander", "profile-charmeleon");
    const aliases = readAliases(vaultPath);
    expect(aliases["profile-charmander"]).toBeDefined();
    expect(aliases["profile-charmander"].current).toBe("profile-charmeleon");
    expect(aliases["profile-charmander"].history).toContain("profile-charmander");
  });

  it("throws when the new id already exists (no clobber)", () => {
    const profilesDir = join(vaultPath, "wikis", "_agents", "profiles");
    writeFileSync(join(profilesDir, "profile-charmeleon.md"),
      `---
id: profile-charmeleon
title: Existing
type: profile
wiki: _agents
status: active
created: 2026-04-29
updated: 2026-04-29
summary: pre-existing
pokemon_type: fire
evolution_stage: stage1
autonomy_level: feature-branch
moveset: []
applies_to: [claude-code]
---
`);
    expect(() => renameProfile(vaultPath, "profile-charmander", "profile-charmeleon"))
      .toThrow(/already exists/i);
  });
});
