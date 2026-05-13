import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeProfile, listProfilesEnriched, ProfileEnriched } from "../../src/core/profiles.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVault(): string {
  const vaultPath = mkdtempSync(join(tmpdir(), "vault-profiles-enriched-summary-"));
  mkdirSync(join(vaultPath, "wikis", "_agents", "profiles"), { recursive: true });
  mkdirSync(join(vaultPath, "wikis", "_agents", "tasks"), { recursive: true });
  return vaultPath;
}

/** Write a raw profile .md file directly (bypassing writeProfile) so we can
 *  plant arbitrary frontmatter values, including system: true. */
function writeRawProfile(vaultPath: string, id: string, frontmatterLines: string[], body = ""): void {
  const fm = ["---", ...frontmatterLines, "---"].join("\n");
  const content = body ? `${fm}\n\n${body}` : fm;
  writeFileSync(join(vaultPath, "wikis", "_agents", "profiles", `${id}.md`), content, "utf8");
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("listProfilesEnriched — summary and system fields", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = makeVault();
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // summary field
  // -------------------------------------------------------------------------

  it("reads summary from frontmatter when present", () => {
    writeRawProfile(vaultPath, "profile-squirtle", [
      "id: profile-squirtle",
      "title: Squirtle",
      "type: profile",
      "wiki: _agents",
      "pokemon_type: water",
      "evolution_stage: basic",
      "moveset: []",
      `summary: "Water specialist — frontend flows"`,
      "created: 2026-01-01",
      "updated: 2026-01-01",
      "status: active",
    ]);

    const result = listProfilesEnriched(vaultPath);
    expect(result.length).toBe(1);
    expect(result[0].summary).toBe("Water specialist — frontend flows");
  });

  it("returns undefined for summary when frontmatter summary is missing", () => {
    writeRawProfile(vaultPath, "profile-squirtle", [
      "id: profile-squirtle",
      "title: Squirtle",
      "type: profile",
      "wiki: _agents",
      "pokemon_type: water",
      "evolution_stage: basic",
      "moveset: []",
      "created: 2026-01-01",
      "updated: 2026-01-01",
      "status: active",
    ]);

    const result = listProfilesEnriched(vaultPath);
    expect(result.length).toBe(1);
    expect(result[0].summary).toBeUndefined();
  });

  it("normalizes empty string summary to undefined", () => {
    writeRawProfile(vaultPath, "profile-squirtle", [
      "id: profile-squirtle",
      "title: Squirtle",
      "type: profile",
      "wiki: _agents",
      "pokemon_type: water",
      "evolution_stage: basic",
      "moveset: []",
      `summary: ""`,
      "created: 2026-01-01",
      "updated: 2026-01-01",
      "status: active",
    ]);

    const result = listProfilesEnriched(vaultPath);
    expect(result[0].summary).toBeUndefined();
  });

  it("normalizes whitespace-only summary to undefined", () => {
    writeRawProfile(vaultPath, "profile-squirtle", [
      "id: profile-squirtle",
      "title: Squirtle",
      "type: profile",
      "wiki: _agents",
      "pokemon_type: water",
      "evolution_stage: basic",
      "moveset: []",
      "summary: '   '",
      "created: 2026-01-01",
      "updated: 2026-01-01",
      "status: active",
    ]);

    const result = listProfilesEnriched(vaultPath);
    expect(result[0].summary).toBeUndefined();
  });

  it("normalizes YAML block scalar (>-) summary that parses to empty/whitespace to undefined", () => {
    // Gray-matter parses `summary: >-\n  \n` as empty string after YAML folding
    const rawContent = [
      "---",
      "id: profile-squirtle",
      "title: Squirtle",
      "type: profile",
      "wiki: _agents",
      "pokemon_type: water",
      "evolution_stage: basic",
      "moveset: []",
      "summary: >-",
      "  ",
      "created: 2026-01-01",
      "updated: 2026-01-01",
      "status: active",
      "---",
    ].join("\n");
    writeFileSync(
      join(vaultPath, "wikis", "_agents", "profiles", "profile-squirtle.md"),
      rawContent,
      "utf8"
    );

    const result = listProfilesEnriched(vaultPath);
    expect(result[0].summary).toBeUndefined();
  });

  it("trims leading/trailing whitespace from a non-empty summary", () => {
    writeRawProfile(vaultPath, "profile-squirtle", [
      "id: profile-squirtle",
      "title: Squirtle",
      "type: profile",
      "wiki: _agents",
      "pokemon_type: water",
      "evolution_stage: basic",
      "moveset: []",
      `summary: "  Water type  "`,
      "created: 2026-01-01",
      "updated: 2026-01-01",
      "status: active",
    ]);

    const result = listProfilesEnriched(vaultPath);
    expect(result[0].summary).toBe("Water type");
  });

  // -------------------------------------------------------------------------
  // system field
  // -------------------------------------------------------------------------

  it("returns system: true when frontmatter has system: true", () => {
    writeRawProfile(vaultPath, "profile-mewtwo", [
      "id: profile-mewtwo",
      "title: Mewtwo",
      "type: profile",
      "wiki: _agents",
      "pokemon_type: psychic",
      "evolution_stage: stage2",
      "moveset: []",
      `summary: "Merge orchestrator"`,
      "system: true",
      "created: 2026-01-01",
      "updated: 2026-01-01",
      "status: active",
    ]);

    const result = listProfilesEnriched(vaultPath);
    expect(result.length).toBe(1);
    expect(result[0].system).toBe(true);
  });

  it("returns system: undefined when frontmatter lacks system field", () => {
    writeRawProfile(vaultPath, "profile-squirtle", [
      "id: profile-squirtle",
      "title: Squirtle",
      "type: profile",
      "wiki: _agents",
      "pokemon_type: water",
      "evolution_stage: basic",
      "moveset: []",
      `summary: "Water type"`,
      "created: 2026-01-01",
      "updated: 2026-01-01",
      "status: active",
    ]);

    const result = listProfilesEnriched(vaultPath);
    expect(result[0].system).toBeUndefined();
  });

  it("returns system: undefined when frontmatter has system: false", () => {
    writeRawProfile(vaultPath, "profile-squirtle", [
      "id: profile-squirtle",
      "title: Squirtle",
      "type: profile",
      "wiki: _agents",
      "pokemon_type: water",
      "evolution_stage: basic",
      "moveset: []",
      `summary: "Water type"`,
      "system: false",
      "created: 2026-01-01",
      "updated: 2026-01-01",
      "status: active",
    ]);

    const result = listProfilesEnriched(vaultPath);
    // system: false in frontmatter should not propagate — undefined means "not system"
    expect(result[0].system).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Combined: multiple profiles, mixed system flags
  // -------------------------------------------------------------------------

  it("correctly reads summary and system across multiple profiles", () => {
    writeRawProfile(vaultPath, "profile-squirtle", [
      "id: profile-squirtle",
      "title: Squirtle",
      "type: profile",
      "wiki: _agents",
      "pokemon_type: water",
      "evolution_stage: basic",
      "moveset: []",
      `summary: "Frontend flows"`,
      "created: 2026-01-01",
      "updated: 2026-01-01",
      "status: active",
    ]);
    writeRawProfile(vaultPath, "profile-mewtwo", [
      "id: profile-mewtwo",
      "title: Mewtwo",
      "type: profile",
      "wiki: _agents",
      "pokemon_type: psychic",
      "evolution_stage: stage2",
      "moveset: []",
      `summary: "Merge orchestrator"`,
      "system: true",
      "created: 2026-01-01",
      "updated: 2026-01-01",
      "status: active",
    ]);

    const result = listProfilesEnriched(vaultPath);
    expect(result.length).toBe(2);

    const squirtle = result.find(p => p.id === "profile-squirtle")!;
    const mewtwo = result.find(p => p.id === "profile-mewtwo")!;

    expect(squirtle.summary).toBe("Frontend flows");
    expect(squirtle.system).toBeUndefined();

    expect(mewtwo.summary).toBe("Merge orchestrator");
    expect(mewtwo.system).toBe(true);
  });

  // -------------------------------------------------------------------------
  // TypeScript shape: ProfileEnriched must have the new fields
  // -------------------------------------------------------------------------

  it("ProfileEnriched interface has summary? and system? fields (compile-time check)", () => {
    // This test primarily validates the TypeScript shape compiles.
    const profile: ProfileEnriched = {
      id: "profile-pikachu",
      title: "Pikachu",
      pokemon_type: "electric",
      evolution_stage: "basic",
      moveset: [],
      wiki: "_agents",
      pokemon: "pikachu",
      updated: "2026-01-01T00:00:00.000Z",
      claimedTaskCount: 0,
      summary: "Electric type",
      system: true,
    };
    expect(profile.summary).toBe("Electric type");
    expect(profile.system).toBe(true);

    // Also verify fields are truly optional
    const profileNoOptionals: ProfileEnriched = {
      id: "profile-pikachu",
      title: "Pikachu",
      pokemon_type: "electric",
      evolution_stage: "basic",
      moveset: [],
      wiki: "_agents",
      pokemon: "pikachu",
      updated: "2026-01-01T00:00:00.000Z",
      claimedTaskCount: 0,
    };
    expect(profileNoOptionals.summary).toBeUndefined();
    expect(profileNoOptionals.system).toBeUndefined();
  });
});
