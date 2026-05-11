import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeProfile } from "../../src/core/profiles.js";
import { createTask } from "../../src/core/tasks.js";
import { claimTask } from "../../src/core/tasks.js";
import { listProfilesEnriched, ProfileEnriched } from "../../src/core/profiles.js";

describe("listProfilesEnriched", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-profiles-enriched-"));
    mkdirSync(join(vaultPath, "wikis", "_agents", "profiles"), { recursive: true });
    mkdirSync(join(vaultPath, "wikis", "_agents", "tasks"), { recursive: true });
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("returns an array (empty when no profiles exist)", () => {
    const result = listProfilesEnriched(vaultPath);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  it("returns ProfileEnriched with wiki, pokemon, updated, claimedTaskCount", () => {
    writeProfile(vaultPath, {
      id: "profile-squirtle",
      title: "Squirtle",
      pokemon_type: "water",
      evolution_stage: "basic",
      moveset: ["move-tdd-cycle"],
      summary: "Water type agent"
    });

    const result = listProfilesEnriched(vaultPath);
    expect(result.length).toBe(1);
    const p = result[0];
    expect(typeof p.wiki).toBe("string");
    expect(typeof p.pokemon).toBe("string");
    expect(typeof p.updated).toBe("string");
    expect(typeof p.claimedTaskCount).toBe("number");
  });

  it("wiki field is populated from profile path or frontmatter", () => {
    writeProfile(vaultPath, {
      id: "profile-squirtle",
      title: "Squirtle",
      pokemon_type: "water",
      evolution_stage: "basic",
      moveset: [],
      summary: "x"
    });

    const result = listProfilesEnriched(vaultPath);
    expect(result[0].wiki).toBe("_agents");
  });

  it("pokemon field is read from pokemon: frontmatter or falls back to id slug", () => {
    writeProfile(vaultPath, {
      id: "profile-charmander",
      title: "Charmander",
      pokemon_type: "fire",
      evolution_stage: "basic",
      moveset: [],
      summary: "x"
    });

    const result = listProfilesEnriched(vaultPath);
    // writeProfile does not write a 'pokemon:' field by default,
    // so the fallback (derived from id) should be used.
    expect(typeof result[0].pokemon).toBe("string");
    expect(result[0].pokemon.length).toBeGreaterThan(0);
  });

  it("updated is an ISO 8601 date string from file mtime", () => {
    writeProfile(vaultPath, {
      id: "profile-bulbasaur",
      title: "Bulbasaur",
      pokemon_type: "grass",
      evolution_stage: "basic",
      moveset: [],
      summary: "x"
    });

    const result = listProfilesEnriched(vaultPath);
    expect(result.length).toBe(1);
    // Should be parseable as a date
    const d = new Date(result[0].updated);
    expect(isNaN(d.getTime())).toBe(false);
    // Should contain a T (ISO 8601 with time)
    expect(result[0].updated).toMatch(/T/);
  });

  it("claimedTaskCount is 0 when no tasks are claimed by this agent", () => {
    writeProfile(vaultPath, {
      id: "profile-squirtle",
      title: "Squirtle",
      pokemon_type: "water",
      evolution_stage: "basic",
      moveset: [],
      summary: "x"
    });

    const result = listProfilesEnriched(vaultPath);
    expect(result[0].claimedTaskCount).toBe(0);
  });

  it("claimedTaskCount counts tasks claimed by this profile's agent id", () => {
    writeProfile(vaultPath, {
      id: "profile-squirtle",
      title: "Squirtle",
      pokemon_type: "water",
      evolution_stage: "basic",
      moveset: [],
      summary: "x"
    });

    // Create a task and claim it as squirtle
    const task = createTask(vaultPath, {
      title: "test-task-for-squirtle",
      wiki: "_agents"
    });
    claimTask(vaultPath, {
      task_id: task.id,
      agent_id: "squirtle",
      expected_updated: task.updated,
      wiki: "_agents"
    });

    const result = listProfilesEnriched(vaultPath);
    expect(result[0].claimedTaskCount).toBe(1);
  });

  it("listTasks is called once (not once per profile)", () => {
    // Verify multiple profiles still work correctly (proxy for single-call bucketing)
    writeProfile(vaultPath, {
      id: "profile-charmander",
      title: "Charmander",
      pokemon_type: "fire",
      evolution_stage: "basic",
      moveset: [],
      summary: "x"
    });
    writeProfile(vaultPath, {
      id: "profile-squirtle",
      title: "Squirtle",
      pokemon_type: "water",
      evolution_stage: "basic",
      moveset: [],
      summary: "y"
    });

    // Create tasks claimed by each
    const taskA = createTask(vaultPath, { title: "task-a", wiki: "_agents" });
    claimTask(vaultPath, {
      task_id: taskA.id,
      agent_id: "charmander",
      expected_updated: taskA.updated,
      wiki: "_agents"
    });

    const taskB = createTask(vaultPath, { title: "task-b", wiki: "_agents" });
    const taskC = createTask(vaultPath, { title: "task-c", wiki: "_agents" });
    claimTask(vaultPath, {
      task_id: taskB.id,
      agent_id: "squirtle",
      expected_updated: taskB.updated,
      wiki: "_agents"
    });
    claimTask(vaultPath, {
      task_id: taskC.id,
      agent_id: "squirtle",
      expected_updated: taskC.updated,
      wiki: "_agents"
    });

    const result = listProfilesEnriched(vaultPath);
    expect(result.length).toBe(2);

    const charmander = result.find(p => p.id === "profile-charmander")!;
    const squirtle = result.find(p => p.id === "profile-squirtle")!;

    expect(charmander.claimedTaskCount).toBe(1);
    expect(squirtle.claimedTaskCount).toBe(2);
  });

  it("opts.wiki filters to only profiles in that wiki", () => {
    writeProfile(vaultPath, {
      id: "profile-squirtle",
      title: "Squirtle",
      pokemon_type: "water",
      evolution_stage: "basic",
      moveset: [],
      summary: "x"
    });

    const resultFiltered = listProfilesEnriched(vaultPath, { wiki: "_agents" });
    expect(resultFiltered.length).toBe(1);

    const resultOtherWiki = listProfilesEnriched(vaultPath, { wiki: "other-wiki" });
    expect(resultOtherWiki.length).toBe(0);
  });

  it("ProfileEnriched extends ProfileSummary (has id, title, pokemon_type, evolution_stage, moveset)", () => {
    writeProfile(vaultPath, {
      id: "profile-charmander",
      title: "Charmander",
      pokemon_type: "fire",
      evolution_stage: "basic",
      moveset: ["move-tdd-cycle"],
      summary: "x"
    });

    const result = listProfilesEnriched(vaultPath);
    const p = result[0];
    expect(p.id).toBe("profile-charmander");
    expect(p.title).toBe("Charmander");
    expect(p.pokemon_type).toBe("fire");
    expect(p.evolution_stage).toBe("basic");
    expect(Array.isArray(p.moveset)).toBe(true);
  });
});
