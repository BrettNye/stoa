// vault-mcp/tests/unit/evolution-claims-orchestrator.test.ts
//
// task-evolution-orchestrator (Claims Plan 2 Wave 2): exercises the additive
// claim-driven extensions to `proposeEvolution`. Existing v1.5 shape is
// preserved; the new fields (`specialties`, `moveset_suggestions`,
// `eligibility`, `evidence_summary`) appear regardless of whether
// `vaultPath` is supplied — empty/zero defaults when omitted.
//
// Hermetic: every test that touches disk uses `mkTempVault` /
// `writeClaimFile`. `today` is always injected; the orchestrator must not
// call `Date.now()`.

import { describe, it, expect } from "vitest";
import { proposeEvolution } from "../../src/core/evolution.js";
import { mkTempVault, writeClaimFile } from "../helpers.js";

const baseProfile = {
  id: "profile-charmander",
  title: "Charmander",
  pokemon_type: "fire" as const,
  evolution_stage: "basic" as const,
  autonomy_level: "restricted" as const,
  moveset: ["move-tdd-cycle"],
  created: "2026-01-01",
};

describe("proposeEvolution with claims (additive Plan 2 fields)", () => {
  it("returns empty claims fields when vaultPath omitted (legacy back-compat)", () => {
    const out = proposeEvolution({
      profile: baseProfile,
      stats: { tasks_completed: 5, tasks_failed: 1, success_rate: 0.8, moves_used_freq: {} },
    });
    // Existing v1.5 shape preserved
    expect(out.eligible).toBe(false);
    expect(out.current.evolution_stage).toBe("basic");
    expect(typeof out.rationale).toBe("string");
    // New additive fields default to empty/zero
    expect(out.proposed.specialties).toEqual([]);
    expect(out.proposed.moveset_suggestions).toEqual([]);
    expect(out.eligibility.eligible).toBe(false);
    expect(out.eligibility.high_confidence_claim_count).toBe(0);
    expect(out.eligibility.threshold).toBe(0);
    expect(out.eligibility.reason).toMatch(/skipped|no vaultPath/i);
    expect(out.evidence_summary.total_active_claims).toBe(0);
    expect(out.evidence_summary.above_threshold_count).toBe(0);
    expect(out.evidence_summary.superseded_count).toBe(0);
    expect(out.evidence_summary.top_clusters).toEqual([]);
  });

  it("preserves existing v1.5 rationale shape (no 'memory' string when memory_page_id omitted, even with claims path skipped)", () => {
    const out = proposeEvolution({
      profile: baseProfile,
      stats: { tasks_completed: 30, tasks_failed: 0, success_rate: 1.0, moves_used_freq: {} },
    });
    expect(out.eligible).toBe(true);
    expect(out.rationale).not.toMatch(/memory/);
    expect(out.rationale).not.toMatch(/synthesis-/);
  });

  it("surfaces specialties and rationale when vaultPath + today + claims present", async () => {
    const vault = await mkTempVault();
    for (let i = 0; i < 5; i++) {
      await writeClaimFile(vault, {
        id: `claim-w${i}`,
        key: `test.win-${i}`,
        status: "active",
        confidence: 0.8,
        profile: ["profile-charmander"],
        tags: ["windows"],
        evidence: ["[[journal-x]]"],
      });
    }
    const out = await proposeEvolution({
      profile: baseProfile,
      stats: { tasks_completed: 0, tasks_failed: 0, success_rate: 0, moves_used_freq: {} },
      vaultPath: vault,
      today: new Date("2026-05-03"),
    });
    const specialty = out.proposed.specialties.find((s) => s.tag === "windows");
    expect(specialty).toBeTruthy();
    expect(specialty!.claim_count).toBe(5);
    expect(out.rationale).toContain("Top tag clusters");
    expect(out.rationale).toContain("windows");
  });

  it("emits moveset suggestions for uncovered clusters with example claim ids ordered by stored confidence", async () => {
    const vault = await mkTempVault();
    // All confidences must clear the spec §6.2 default render_min_confidence
    // (0.4) post-decay; a 1-day delta against half-life 75 still leaves any
    // value >= ~0.42 above the floor. Pick spread values >= 0.5.
    const confidences = [0.6, 0.9, 0.5, 0.8, 0.7];
    for (let i = 0; i < 5; i++) {
      await writeClaimFile(vault, {
        id: `claim-pwsh-${i}`,
        key: `pwsh.case-${i}`,
        status: "active",
        confidence: confidences[i],
        profile: ["profile-charmander"],
        tags: ["powershell"],
        evidence: ["[[journal-x]]"],
      });
    }
    const out = await proposeEvolution({
      profile: baseProfile,
      stats: { tasks_completed: 0, tasks_failed: 0, success_rate: 0, moves_used_freq: {} },
      vaultPath: vault,
      today: new Date("2026-05-03"),
    });
    expect(out.proposed.moveset_suggestions.length).toBe(1);
    const sugg = out.proposed.moveset_suggestions[0];
    expect(sugg.tag_cluster).toEqual(["powershell"]);
    expect(sugg.move_hint).toBe("move-powershell-handler");
    expect(sugg.claim_count).toBe(5);
    // Highest stored confidence first; capped at 3
    expect(sugg.example_claim_ids.length).toBe(3);
    expect(sugg.example_claim_ids[0]).toBe("claim-pwsh-1"); // 0.9
    expect(sugg.example_claim_ids[1]).toBe("claim-pwsh-3"); // 0.8
    expect(sugg.example_claim_ids[2]).toBe("claim-pwsh-4"); // 0.7
    // The "consider authoring" line appears when uncovered hints exist
    expect(out.rationale).toContain("consider authoring");
    expect(out.rationale).toContain("move-powershell-handler");
  });

  it("computes eligibility using high-confidence claim count and configured thresholds", async () => {
    const vault = await mkTempVault();
    // Write 10 claims (matches default stage1 threshold)
    for (let i = 0; i < 10; i++) {
      await writeClaimFile(vault, {
        id: `claim-batch-${i}`,
        key: `batch.case-${i}`,
        status: "active",
        confidence: 0.9,
        profile: ["profile-charmander"],
        tags: [`bucket-${i % 2}`],
        evidence: ["[[journal-x]]"],
      });
    }
    const out = await proposeEvolution({
      profile: baseProfile,
      stats: { tasks_completed: 0, tasks_failed: 0, success_rate: 0, moves_used_freq: {} },
      vaultPath: vault,
      today: new Date("2026-05-03"),
    });
    expect(out.eligibility.eligible).toBe(true);
    expect(out.eligibility.high_confidence_claim_count).toBe(10);
    expect(out.eligibility.threshold).toBe(10);
    expect(out.eligibility.reason).toMatch(/10 >= 10/);
  });

  it("returns empty claims fields when profile has no claims (sidecar absent, no claim files)", async () => {
    const vault = await mkTempVault();
    const out = await proposeEvolution({
      profile: baseProfile,
      stats: { tasks_completed: 0, tasks_failed: 0, success_rate: 0, moves_used_freq: {} },
      vaultPath: vault,
      today: new Date("2026-05-03"),
    });
    expect(out.proposed.specialties).toEqual([]);
    expect(out.proposed.moveset_suggestions).toEqual([]);
    expect(out.eligibility.eligible).toBe(false);
    expect(out.eligibility.high_confidence_claim_count).toBe(0);
    expect(out.evidence_summary.total_active_claims).toBe(0);
    expect(out.evidence_summary.top_clusters).toEqual([]);
  });

  it("evidence_summary.top_clusters is sorted by claim count desc and capped at 3", async () => {
    const vault = await mkTempVault();
    // Six tags: a x6, b x5, c x5, d x5, e x4 (e dropped — below specialty_min_cluster=5)
    const layout: Record<string, number> = { a: 6, b: 5, c: 5, d: 5, e: 4 };
    let n = 0;
    for (const [tag, count] of Object.entries(layout)) {
      for (let i = 0; i < count; i++) {
        await writeClaimFile(vault, {
          id: `claim-${tag}-${i}`,
          key: `topic.${tag}-${i}-${n++}`,
          status: "active",
          confidence: 0.9,
          profile: ["profile-charmander"],
          tags: [tag],
          evidence: ["[[journal-x]]"],
        });
      }
    }
    const out = await proposeEvolution({
      profile: baseProfile,
      stats: { tasks_completed: 0, tasks_failed: 0, success_rate: 0, moves_used_freq: {} },
      vaultPath: vault,
      today: new Date("2026-05-03"),
    });
    // 6+5+5+5+4 = 25 active; 4 surviving clusters (a/b/c/d)
    expect(out.evidence_summary.total_active_claims).toBe(25);
    expect(out.evidence_summary.above_threshold_count).toBe(25);
    expect(out.evidence_summary.top_clusters.length).toBe(3);
    expect(out.evidence_summary.top_clusters[0]).toEqual({ tag: "a", count: 6 });
    // Other entries are 5-each (b/c/d in some order)
    expect(out.evidence_summary.top_clusters.slice(1).map((c) => c.count)).toEqual([5, 5]);
    // Specialties has all 4 surviving clusters (e dropped)
    const tags = out.proposed.specialties.map((s) => s.tag).sort();
    expect(tags).toEqual(["a", "b", "c", "d"]);
  });

  it("preserves the top-level v1.5 `eligible` field independently of the new claim-driven `eligibility` block", async () => {
    const vault = await mkTempVault();
    // No claims — claim-driven eligibility false, but stats-driven still passes
    const out = await proposeEvolution({
      profile: baseProfile,
      stats: { tasks_completed: 30, tasks_failed: 0, success_rate: 1.0, moves_used_freq: {} },
      vaultPath: vault,
      today: new Date("2026-05-03"),
    });
    // v1.5 stats-driven: 30 tasks at 1.0 success → eligible
    expect(out.eligible).toBe(true);
    // claim-driven: zero high-confidence claims → not eligible
    expect(out.eligibility.eligible).toBe(false);
  });

  it("surfaces no moveset_suggestions when current moveset already covers the cluster tag via SKILL.md", async () => {
    const vault = await mkTempVault();
    // Stand up a SKILL.md for move-tdd-cycle covering the "windows" tag
    const { promises: fsp } = await import("node:fs");
    const path = await import("node:path");
    const skillDir = path.join(vault, "wikis", "_agents", "moves", "move-tdd-cycle");
    await fsp.mkdir(skillDir, { recursive: true });
    await fsp.writeFile(
      path.join(skillDir, "SKILL.md"),
      `---\ntags: ["windows"]\napplies_to: []\n---\n\nbody\n`,
      "utf8",
    );
    for (let i = 0; i < 5; i++) {
      await writeClaimFile(vault, {
        id: `claim-cov-${i}`,
        key: `cov.case-${i}`,
        status: "active",
        confidence: 0.8,
        profile: ["profile-charmander"],
        tags: ["windows"],
        evidence: ["[[journal-x]]"],
      });
    }
    const out = await proposeEvolution({
      profile: baseProfile,
      stats: { tasks_completed: 0, tasks_failed: 0, success_rate: 0, moves_used_freq: {} },
      vaultPath: vault,
      today: new Date("2026-05-03"),
    });
    expect(out.proposed.specialties.length).toBe(1);
    expect(out.proposed.specialties[0].tag).toBe("windows");
    // Tag is covered → no suggestion
    expect(out.proposed.moveset_suggestions).toEqual([]);
    // Rationale should NOT include "consider authoring"
    expect(out.rationale).not.toContain("consider authoring");
  });

  it("does not call Date.now() — same vault + same `today` produces identical output across two invocations", async () => {
    const vault = await mkTempVault();
    for (let i = 0; i < 5; i++) {
      await writeClaimFile(vault, {
        id: `claim-det-${i}`,
        key: `det.case-${i}`,
        status: "active",
        confidence: 0.7,
        profile: ["profile-charmander"],
        tags: ["determinism"],
        evidence: ["[[journal-x]]"],
      });
    }
    const today = new Date("2026-05-03");
    const a = await proposeEvolution({
      profile: baseProfile,
      stats: { tasks_completed: 0, tasks_failed: 0, success_rate: 0, moves_used_freq: {} },
      vaultPath: vault,
      today,
    });
    const b = await proposeEvolution({
      profile: baseProfile,
      stats: { tasks_completed: 0, tasks_failed: 0, success_rate: 0, moves_used_freq: {} },
      vaultPath: vault,
      today,
    });
    expect(a.rationale).toBe(b.rationale);
    expect(a.proposed.specialties).toEqual(b.proposed.specialties);
    expect(a.proposed.moveset_suggestions).toEqual(b.proposed.moveset_suggestions);
    expect(a.evidence_summary).toEqual(b.evidence_summary);
  });

  it("returns frozen singletons from the legacy (no-vaultPath) path so caller mutations cannot corrupt shared state", () => {
    // Two back-to-back calls share the same SKIPPED_ELIGIBILITY /
    // EMPTY_EVIDENCE_SUMMARY by reference. Object.freeze means a hostile
    // or buggy caller can't poison subsequent calls in the same process.
    const a = proposeEvolution({
      profile: baseProfile,
      stats: { tasks_completed: 5, tasks_failed: 1, success_rate: 0.8, moves_used_freq: {} },
    });
    expect(Object.isFrozen(a.eligibility)).toBe(true);
    expect(Object.isFrozen(a.evidence_summary)).toBe(true);
    expect(Object.isFrozen(a.evidence_summary.top_clusters)).toBe(true);

    // Attempting to mutate must throw in strict mode (ES modules are strict).
    expect(() => {
      (a.eligibility as { eligible: boolean }).eligible = true;
    }).toThrow();
    expect(() => {
      a.evidence_summary.top_clusters.push({ tag: "x", count: 1 });
    }).toThrow();

    // A subsequent call still sees the pristine shape.
    const b = proposeEvolution({
      profile: baseProfile,
      stats: { tasks_completed: 5, tasks_failed: 1, success_rate: 0.8, moves_used_freq: {} },
    });
    expect(b.eligibility.eligible).toBe(false);
    expect(b.evidence_summary.top_clusters).toEqual([]);
  });
});
