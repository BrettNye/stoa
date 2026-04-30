import { describe, it, expect } from "vitest";
import { proposeEvolution } from "../../src/core/evolution.js";

const baseProfile = {
  id: "profile-charmander",
  title: "Charmander",
  pokemon_type: "fire" as const,
  evolution_stage: "basic" as const,
  autonomy_level: "restricted" as const,
  moveset: ["move-tdd-cycle", "move-channel-coordinate"],
  created: "2026-01-01"
};

describe("proposeEvolution", () => {
  it("returns eligible:false with a reason when thresholds not met", () => {
    const prop = proposeEvolution({
      profile: baseProfile,
      stats: { tasks_completed: 5, tasks_failed: 1, success_rate: 0.8, moves_used_freq: {} }
    });
    expect(prop.eligible).toBe(false);
    expect(prop.reason).toMatch(/needs.*more|tasks_completed/i);
    // Even when ineligible, current/proposed shape stays well-formed
    expect(prop.current.evolution_stage).toBe("basic");
  });

  it("proposes basic → stage1 when 30 tasks at 80% success", () => {
    const prop = proposeEvolution({
      profile: baseProfile,
      stats: { tasks_completed: 30, tasks_failed: 6, success_rate: 0.80, moves_used_freq: {} }
    });
    expect(prop.eligible).toBe(true);
    expect(prop.proposed.evolution_stage).toBe("stage1");
    expect(prop.proposed.autonomy_level).toBe("feature-branch");
    expect(prop.proposed.name).toBeNull(); // C.1a leaves naming to PokeAPI (C.1c)
    expect(prop.rationale).toMatch(/30/);
  });

  it("proposes stage1 → stage2 when 100 tasks at 85% success", () => {
    const prop = proposeEvolution({
      profile: { ...baseProfile, evolution_stage: "stage1", autonomy_level: "feature-branch" },
      stats: { tasks_completed: 100, tasks_failed: 15, success_rate: 0.85, moves_used_freq: {} }
    });
    expect(prop.eligible).toBe(true);
    expect(prop.proposed.evolution_stage).toBe("stage2");
    expect(prop.proposed.autonomy_level).toBe("main-branch");
  });

  it("returns eligible:false at stage2 (no further evolution)", () => {
    const prop = proposeEvolution({
      profile: { ...baseProfile, evolution_stage: "stage2", autonomy_level: "main-branch" },
      stats: { tasks_completed: 999, tasks_failed: 0, success_rate: 1.0, moves_used_freq: {} }
    });
    expect(prop.eligible).toBe(false);
    expect(prop.reason).toMatch(/stage2|max/i);
  });

  it("proposes moveset additions for moves used >=10 times not already in moveset (cap 2)", () => {
    const prop = proposeEvolution({
      profile: baseProfile,
      stats: {
        tasks_completed: 30, tasks_failed: 0, success_rate: 1.0,
        moves_used_freq: {
          "move-tdd-cycle": 50,                  // already in moveset; skip
          "move-pr-create": 12,                  // candidate
          "move-debug-failing-test": 11,         // candidate
          "move-research-deposit": 25,           // candidate (more frequent)
          "move-merge-ritual": 5,                // below threshold; skip
        }
      }
    });
    expect(prop.eligible).toBe(true);
    expect(prop.proposed.moveset_additions.length).toBeLessThanOrEqual(2);
    // Most-frequent eligible candidates should be picked first
    expect(prop.proposed.moveset_additions).toContain("move-research-deposit");
  });

  it("proposes moveset removals for moves with 0 invocations (best-effort, no age check in C.1a)", () => {
    // C.1a doesn't have access to per-move created dates without extra index plumbing.
    // For C.1a, removal candidates are simply moves in the moveset with 0 invocations.
    // The 14-day age check from spec §7.3 is deferred to C.1c when index supports it.
    const prop = proposeEvolution({
      profile: { ...baseProfile, moveset: ["move-tdd-cycle", "move-unused-thing"] },
      stats: {
        tasks_completed: 30, tasks_failed: 0, success_rate: 1.0,
        moves_used_freq: { "move-tdd-cycle": 50 }
      }
    });
    expect(prop.eligible).toBe(true);
    expect(prop.proposed.moveset_removals).toContain("move-unused-thing");
    expect(prop.proposed.moveset_removals).not.toContain("move-tdd-cycle");
  });
});
