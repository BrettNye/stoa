import { describe, it, expect } from "vitest";
import {
  POKEMON_TYPES,
  DEV_SPECIALTY_TO_TYPE,
  TYPE_TO_DEV_SPECIALTY,
  EVOLUTION_THRESHOLDS,
  STAGE_TO_AUTONOMY
} from "../../src/core/pokemon.js";

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
