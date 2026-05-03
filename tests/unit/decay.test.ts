import { describe, it, expect } from "vitest";
import { effectiveConfidence } from "../../src/core/decay.js";

describe("effectiveConfidence", () => {
  it("returns raw confidence when last_validated is today", () => {
    const today = new Date("2026-05-02T00:00:00Z");
    const eff = effectiveConfidence(
      { confidence: 0.8, last_validated: "2026-05-02", status: "active" },
      today,
    );
    expect(eff).toBeCloseTo(0.8, 6);
  });

  it("decays to 0.4 at the 75-day half-life", () => {
    const today = new Date("2026-07-16T00:00:00Z"); // 75 days after 2026-05-02
    const eff = effectiveConfidence(
      { confidence: 0.8, last_validated: "2026-05-02", status: "active" },
      today,
    );
    expect(eff).toBeCloseTo(0.4, 3);
  });

  it("clamps at the floor (0.1) × stored confidence at 200 days", () => {
    const today = new Date("2026-11-18T00:00:00Z"); // 200 days after 2026-05-02
    const eff = effectiveConfidence(
      { confidence: 0.8, last_validated: "2026-05-02", status: "active" },
      today,
    );
    expect(eff).toBeCloseTo(0.08, 6);
  });

  it("returns 0 for status: superseded", () => {
    const today = new Date("2026-05-02T00:00:00Z");
    const eff = effectiveConfidence(
      { confidence: 0.8, last_validated: "2026-05-02", status: "superseded" },
      today,
    );
    expect(eff).toBe(0);
  });

  it("returns 0 for status: retracted", () => {
    const today = new Date("2026-05-02T00:00:00Z");
    const eff = effectiveConfidence(
      { confidence: 0.8, last_validated: "2026-05-02", status: "retracted" },
      today,
    );
    expect(eff).toBe(0);
  });

  it("respects half_life_days override of 30 (≈ 0.4 at 30 days)", () => {
    const today = new Date("2026-06-01T00:00:00Z"); // 30 days after 2026-05-02
    const eff = effectiveConfidence(
      { confidence: 0.8, last_validated: "2026-05-02", status: "active" },
      today,
      { half_life_days: 30 },
    );
    expect(eff).toBeCloseTo(0.4, 3);
  });

  it("clamps last_validated in the future to 0 days and returns raw confidence", () => {
    const today = new Date("2026-05-02T00:00:00Z");
    const eff = effectiveConfidence(
      { confidence: 0.8, last_validated: "2026-06-01", status: "active" },
      today,
    );
    expect(eff).toBeCloseTo(0.8, 6);
  });
});
