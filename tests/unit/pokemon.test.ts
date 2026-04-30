import { describe, it, expect } from "vitest";
import {
  POKEMON_TYPES,
  DEV_SPECIALTY_TO_TYPE,
  TYPE_TO_DEV_SPECIALTY,
  EVOLUTION_THRESHOLDS,
  STAGE_TO_AUTONOMY,
  isValidPokemonType,
  mapDevSpecialty,
  defaultAutonomyForStage,
  nextStage,
  thresholdFor,
  meetsThreshold
} from "../../src/core/pokemon.js";

// Legacy tests (v1.5.0 baseline)
describe("POKEMON_TYPES", () => {
  it("contains exactly 18 canonical types", () => {
    expect(POKEMON_TYPES).toHaveLength(18);
  });

  it("includes fire and water", () => {
    expect(POKEMON_TYPES).toContain("fire");
    expect(POKEMON_TYPES).toContain("water");
  });
});

describe("dev-specialty mapping", () => {
  it("maps 'backend' to 'fire'", () => {
    expect(DEV_SPECIALTY_TO_TYPE["backend"]).toBe("fire");
  });

  it("maps 'frontend' to 'water'", () => {
    expect(DEV_SPECIALTY_TO_TYPE["frontend"]).toBe("water");
  });

  it("reverse mapping is consistent", () => {
    expect(TYPE_TO_DEV_SPECIALTY["fire"]).toBe("backend");
    expect(TYPE_TO_DEV_SPECIALTY["water"]).toBe("frontend");
  });
});

describe("EVOLUTION_THRESHOLDS", () => {
  it("requires 30 tasks for stage1", () => {
    expect(EVOLUTION_THRESHOLDS.stage1.tasks_completed).toBe(30);
    expect(EVOLUTION_THRESHOLDS.stage1.success_rate).toBe(0.80);
  });

  it("requires 100 tasks for stage2", () => {
    expect(EVOLUTION_THRESHOLDS.stage2.tasks_completed).toBe(100);
    expect(EVOLUTION_THRESHOLDS.stage2.success_rate).toBe(0.85);
  });
});

describe("STAGE_TO_AUTONOMY", () => {
  it("basic → restricted", () => {
    expect(STAGE_TO_AUTONOMY["basic"]).toBe("restricted");
  });
  it("stage1 → feature-branch", () => {
    expect(STAGE_TO_AUTONOMY["stage1"]).toBe("feature-branch");
  });
  it("stage2 → main-branch", () => {
    expect(STAGE_TO_AUTONOMY["stage2"]).toBe("main-branch");
  });
});

// New tests (Wave 0 additions)
describe("pokemon constants", () => {
  it("POKEMON_TYPES has exactly the 18 canonical types", () => {
    expect(POKEMON_TYPES.length).toBe(18);
    expect(POKEMON_TYPES).toContain("fire");
    expect(POKEMON_TYPES).toContain("water");
    expect(POKEMON_TYPES).toContain("ghost");
    expect(POKEMON_TYPES).toContain("normal");
  });

  it("isValidPokemonType returns true for canonical types and false otherwise", () => {
    expect(isValidPokemonType("fire")).toBe(true);
    expect(isValidPokemonType("Fire")).toBe(false); // case-sensitive
    expect(isValidPokemonType("invalid")).toBe(false);
    expect(isValidPokemonType("")).toBe(false);
  });

  it("mapDevSpecialty translates known specialties to types", () => {
    expect(mapDevSpecialty("backend")).toBe("fire");
    expect(mapDevSpecialty("frontend")).toBe("water");
    expect(mapDevSpecialty("tests")).toBe("ghost");
    expect(mapDevSpecialty("research")).toBe("grass");
    expect(mapDevSpecialty("unknown-specialty")).toBe("normal");
  });
});

describe("evolution stage helpers", () => {
  it("defaultAutonomyForStage maps each stage to expected autonomy_level", () => {
    expect(defaultAutonomyForStage("basic")).toBe("restricted");
    expect(defaultAutonomyForStage("stage1")).toBe("feature-branch");
    expect(defaultAutonomyForStage("stage2")).toBe("main-branch");
  });

  it("nextStage returns the chain successor or null at the top", () => {
    expect(nextStage("basic")).toBe("stage1");
    expect(nextStage("stage1")).toBe("stage2");
    expect(nextStage("stage2")).toBeNull();
  });

  it("thresholdFor returns the canonical thresholds per spec §7.3", () => {
    expect(thresholdFor("basic-to-stage1")).toEqual({ tasks_completed: 30, success_rate: 0.80 });
    expect(thresholdFor("stage1-to-stage2")).toEqual({ tasks_completed: 100, success_rate: 0.85 });
  });

  it("meetsThreshold returns true only when both bars are cleared", () => {
    // basic → stage1 needs 30 tasks AND 0.80 success
    expect(meetsThreshold("basic", { tasks_completed: 30, success_rate: 0.80 })).toBe(true);
    expect(meetsThreshold("basic", { tasks_completed: 30, success_rate: 0.79 })).toBe(false);
    expect(meetsThreshold("basic", { tasks_completed: 29, success_rate: 0.99 })).toBe(false);
    // stage1 → stage2 needs 100 + 0.85
    expect(meetsThreshold("stage1", { tasks_completed: 100, success_rate: 0.85 })).toBe(true);
    expect(meetsThreshold("stage1", { tasks_completed: 99, success_rate: 0.99 })).toBe(false);
    // stage2 has no further evolution
    expect(meetsThreshold("stage2", { tasks_completed: 999, success_rate: 1.0 })).toBe(false);
  });
});
