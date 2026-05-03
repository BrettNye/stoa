import { describe, it, expect } from "vitest";
import {
  ClaimsConfigSchema,
  getClaimsConfig,
  type ClaimsConfig,
} from "../../src/config.js";

// Spec §6.2 canonical defaults — keep in sync with config.ts.
const SPEC_DEFAULTS = {
  half_life_days: 75,
  effective_floor: 0.1,
  render_min_confidence: 0.4,
  render_default_limit: 10,
  staleness_warn_days: 30,
  evolution_thresholds: {
    stage1: 10,
    stage2: 25,
  },
  specialty_min_cluster: 5,
} as const;

describe("getClaimsConfig — defaults", () => {
  it("returns spec §6.2 defaults when raw config is empty object", () => {
    const cfg = getClaimsConfig({});
    expect(cfg).toEqual(SPEC_DEFAULTS);
  });

  it("returns spec §6.2 defaults when claims field is omitted", () => {
    // No claims key at all in the top-level config.
    const cfg = getClaimsConfig({ unrelated: 42 });
    expect(cfg).toEqual(SPEC_DEFAULTS);
  });

  it("returns spec §6.2 defaults when claims is an empty object", () => {
    const cfg = getClaimsConfig({ claims: {} });
    expect(cfg).toEqual(SPEC_DEFAULTS);
  });

  it("treats null/undefined raw config as empty", () => {
    expect(getClaimsConfig(null)).toEqual(SPEC_DEFAULTS);
    expect(getClaimsConfig(undefined)).toEqual(SPEC_DEFAULTS);
  });
});

describe("getClaimsConfig — partial overrides", () => {
  it("override single key keeps other defaults intact", () => {
    const cfg = getClaimsConfig({ claims: { half_life_days: 30 } });
    expect(cfg.half_life_days).toBe(30);
    expect(cfg.effective_floor).toBe(SPEC_DEFAULTS.effective_floor);
    expect(cfg.render_min_confidence).toBe(SPEC_DEFAULTS.render_min_confidence);
    expect(cfg.render_default_limit).toBe(SPEC_DEFAULTS.render_default_limit);
    expect(cfg.staleness_warn_days).toBe(SPEC_DEFAULTS.staleness_warn_days);
    expect(cfg.evolution_thresholds).toEqual(SPEC_DEFAULTS.evolution_thresholds);
    expect(cfg.specialty_min_cluster).toBe(SPEC_DEFAULTS.specialty_min_cluster);
  });

  it("override evolution_thresholds.stage1 keeps stage2 default intact", () => {
    const cfg = getClaimsConfig({
      claims: { evolution_thresholds: { stage1: 20 } },
    });
    expect(cfg.evolution_thresholds.stage1).toBe(20);
    expect(cfg.evolution_thresholds.stage2).toBe(SPEC_DEFAULTS.evolution_thresholds.stage2);
  });

  it("override multiple top-level keys preserves untouched defaults", () => {
    const cfg = getClaimsConfig({
      claims: {
        effective_floor: 0.2,
        specialty_min_cluster: 8,
      },
    });
    expect(cfg.effective_floor).toBe(0.2);
    expect(cfg.specialty_min_cluster).toBe(8);
    expect(cfg.half_life_days).toBe(SPEC_DEFAULTS.half_life_days);
    expect(cfg.evolution_thresholds).toEqual(SPEC_DEFAULTS.evolution_thresholds);
  });
});

describe("getClaimsConfig — schema rejection", () => {
  it("rejects negative half_life_days", () => {
    expect(() => getClaimsConfig({ claims: { half_life_days: -5 } })).toThrow();
  });

  it("rejects zero half_life_days (must be positive)", () => {
    expect(() => getClaimsConfig({ claims: { half_life_days: 0 } })).toThrow();
  });

  it("rejects evolution_thresholds.stage1: 1.5 (must be integer)", () => {
    expect(() =>
      getClaimsConfig({ claims: { evolution_thresholds: { stage1: 1.5 } } })
    ).toThrow();
  });

  it("rejects evolution_thresholds.stage2: 2.5 (must be integer)", () => {
    expect(() =>
      getClaimsConfig({ claims: { evolution_thresholds: { stage2: 2.5 } } })
    ).toThrow();
  });

  it("rejects effective_floor: 1.5 (must be 0–1)", () => {
    expect(() => getClaimsConfig({ claims: { effective_floor: 1.5 } })).toThrow();
  });

  it("rejects effective_floor: -0.1 (must be 0–1)", () => {
    expect(() => getClaimsConfig({ claims: { effective_floor: -0.1 } })).toThrow();
  });

  it("rejects render_min_confidence: 1.5 (must be 0–1)", () => {
    expect(() =>
      getClaimsConfig({ claims: { render_min_confidence: 1.5 } })
    ).toThrow();
  });

  it("rejects render_default_limit: 2.5 (must be integer)", () => {
    expect(() =>
      getClaimsConfig({ claims: { render_default_limit: 2.5 } })
    ).toThrow();
  });

  it("rejects render_default_limit: 0 (must be positive)", () => {
    expect(() =>
      getClaimsConfig({ claims: { render_default_limit: 0 } })
    ).toThrow();
  });

  it("rejects staleness_warn_days: 1.5 (must be integer)", () => {
    expect(() =>
      getClaimsConfig({ claims: { staleness_warn_days: 1.5 } })
    ).toThrow();
  });

  it("rejects specialty_min_cluster: -3", () => {
    expect(() =>
      getClaimsConfig({ claims: { specialty_min_cluster: -3 } })
    ).toThrow();
  });
});

describe("ClaimsConfigSchema — exported defaults exactly match spec values", () => {
  it("parsing an empty object returns spec §6.2 values exactly", () => {
    const parsed: ClaimsConfig = ClaimsConfigSchema.parse({});
    expect(parsed.half_life_days).toBe(75);
    expect(parsed.effective_floor).toBe(0.1);
    expect(parsed.render_min_confidence).toBe(0.4);
    expect(parsed.render_default_limit).toBe(10);
    expect(parsed.staleness_warn_days).toBe(30);
    expect(parsed.evolution_thresholds.stage1).toBe(10);
    expect(parsed.evolution_thresholds.stage2).toBe(25);
    expect(parsed.specialty_min_cluster).toBe(5);
  });
});
