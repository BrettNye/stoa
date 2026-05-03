// vault-mcp/tests/unit/evolve-profile-tool-shape.test.ts
//
// task-evolve-profile-tool-fields (Claims Plan 2 Wave 3): the
// `vault.evolve-profile` tool's `ProposalShape` Zod schema must accept the
// new additive Plan 2 fields (`moveset_suggestions`, `specialties`,
// `eligibility`, `evidence_summary`) without rejection, while remaining
// compatible with v1.5-shape callers that omit them (additive defaults).
//
// Pure schema-level tests. The handler-side wiring (vaultPath/today/config
// pass-through into proposeEvolution) is exercised by an integration test
// elsewhere in Wave 3; here we only assert the inputSchema accepts the new
// shape and that legacy shapes still parse.

import { describe, it, expect } from "vitest";
import { evolveProfileTool } from "../../src/tools/evolve-profile.js";

describe("evolveProfileTool.inputSchema (Plan 2 additive ProposalShape fields)", () => {
  it("accepts the v1.5-shape proposal (no new fields) — additive defaults apply", () => {
    const result = evolveProfileTool.inputSchema.safeParse({
      pokemon_id: "profile-charmander",
      commit: true,
      expected_updated: "2026-05-03",
      proposal: {
        eligible: true,
        current: {
          name: "Charmander",
          evolution_stage: "basic",
          moveset: ["move-tdd-cycle"],
          autonomy_level: "restricted",
        },
        proposed: {
          name: null,
          evolution_stage: "stage1",
          moveset_additions: [],
          moveset_removals: [],
          autonomy_level: "feature-branch",
        },
        rationale: "eligible for basic → stage1",
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // additive defaults: empty arrays
      expect(result.data.proposal?.proposed.moveset_suggestions).toEqual([]);
      expect(result.data.proposal?.proposed.specialties).toEqual([]);
    }
  });

  it("accepts the Plan 2 extended proposal (new fields populated)", () => {
    const result = evolveProfileTool.inputSchema.safeParse({
      pokemon_id: "profile-charmander",
      commit: true,
      expected_updated: "2026-05-03",
      proposal: {
        eligible: true,
        current: {
          name: "Charmander",
          evolution_stage: "basic",
          moveset: ["move-tdd-cycle"],
          autonomy_level: "restricted",
        },
        proposed: {
          name: null,
          evolution_stage: "stage1",
          moveset_additions: [],
          moveset_removals: [],
          autonomy_level: "feature-branch",
          moveset_suggestions: [
            {
              move_hint: "move-windows-handler",
              tag_cluster: ["windows"],
              claim_count: 5,
              example_claim_ids: ["claim-a"],
            },
          ],
          specialties: [{ tag: "windows", claim_count: 5 }],
        },
        rationale: "eligible for basic → stage1; claim-aware",
        eligibility: {
          eligible: true,
          reason: "10 >= 10",
          high_confidence_claim_count: 10,
          threshold: 10,
        },
        evidence_summary: {
          total_active_claims: 10,
          above_threshold_count: 10,
          superseded_count: 0,
          top_clusters: [{ tag: "windows", count: 5 }],
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.proposal?.proposed.moveset_suggestions).toHaveLength(1);
      expect(result.data.proposal?.proposed.specialties[0]?.tag).toBe("windows");
      expect(result.data.proposal?.eligibility?.high_confidence_claim_count).toBe(10);
      expect(result.data.proposal?.evidence_summary?.top_clusters[0]?.count).toBe(5);
    }
  });

  it("rejects malformed Plan 2 fields (e.g. negative claim_count)", () => {
    const result = evolveProfileTool.inputSchema.safeParse({
      pokemon_id: "profile-charmander",
      commit: true,
      expected_updated: "2026-05-03",
      proposal: {
        eligible: true,
        current: {
          name: "Charmander",
          evolution_stage: "basic",
          moveset: [],
          autonomy_level: "restricted",
        },
        proposed: {
          name: null,
          evolution_stage: "stage1",
          moveset_additions: [],
          moveset_removals: [],
          autonomy_level: "feature-branch",
          specialties: [{ tag: "windows", claim_count: -1 }],
        },
        rationale: "rationale",
      },
    });
    expect(result.success).toBe(false);
  });

  it("accepts proposal-phase input (commit:false) without proposal block", () => {
    const result = evolveProfileTool.inputSchema.safeParse({
      pokemon_id: "profile-charmander",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.commit).toBe(false);
    }
  });
});
