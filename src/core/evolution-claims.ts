// vault-mcp/src/core/evolution-claims.ts
//
// task-evolution-claims-helpers (Claims Plan 2): three pure-ish helpers used
// only by the evolution orchestrator. Bundled in one module because they
// share no consumers and splitting yields no parallelism — the orchestrator
// depends on all three.
//
// Pure-ish, not pure: `suggestMoves` reads SKILL.md frontmatter from disk;
// the other two are pure. None of the three call `Date.now()` or random.
//
// Plan reference:
// `wikis/_meta/plans/2026-05-03-vault-mcp-claims-plan-2-evolve-profile-dag.md`
// §task-evolution-claims-helpers.

import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { ParsedClaim } from "./claims.js";
import type { SourceTypeWeights } from "../config.js";
import { effectiveConfidence } from "./decay.js";

// ---------- computeEligibility ----------

export interface EligibilityReport {
  eligible: boolean;
  reason: string;
  high_confidence_claim_count: number;
  threshold: number;
}

/**
 * Pure threshold check. `basic → stage1` uses `thresholds.stage1`; `stage1 →
 * stage2` uses `thresholds.stage2`. `stage2` has no further evolution — the
 * report is `eligible: false` with an explanatory reason and `threshold: 0`
 * (the caller should not use `threshold` when `eligible` is false at
 * stage2 — there is no next threshold to clear).
 */
export function computeEligibility(
  highConfidenceCount: number,
  currentStage: "basic" | "stage1" | "stage2",
  thresholds: { stage1: number; stage2: number },
): EligibilityReport {
  if (currentStage === "stage2") {
    return {
      eligible: false,
      reason: "Already at stage2 — no further evolution",
      high_confidence_claim_count: highConfidenceCount,
      threshold: 0,
    };
  }
  const threshold = currentStage === "basic" ? thresholds.stage1 : thresholds.stage2;
  const eligible = highConfidenceCount >= threshold;
  const reason = eligible
    ? `${highConfidenceCount} >= ${threshold} high-confidence claims for ${currentStage}`
    : `needs >=${threshold} high-confidence claims for ${currentStage}, has ${highConfidenceCount}`;
  return { eligible, reason, high_confidence_claim_count: highConfidenceCount, threshold };
}

// ---------- suggestMoves ----------

export interface MovesetSuggestion {
  move_hint: string;
  tag_cluster: string[];
  claim_count: number;
  example_claim_ids: string[];
}

/**
 * For each surviving cluster, check whether any move in `currentMoveset`
 * already covers the cluster's tag via SKILL.md frontmatter `tags:` ∪
 * `applies_to:`. If yes, no suggestion. If no, emit one
 * `MovesetSuggestion`.
 *
 * Missing or malformed SKILL.md is tolerated and treated as covering nothing
 * (so a cluster whose only "covering" move has a broken skill file still
 * produces a suggestion). The path inspected is
 * `<vault>/wikis/_agents/moves/<moveId>/SKILL.md` — that is the canonical
 * location per the v1.5 substrate (`vault_sync-skills`).
 *
 * `example_claim_ids` is sorted by the claim's *stored* `confidence`
 * (descending), capped at 3. The orchestrator's contract uses *effective*
 * confidence elsewhere (decayed), but for the suggestion's example list the
 * stored value is sufficient and avoids needing to plumb the decay config
 * down here.
 */
export async function suggestMoves(
  clusters: Map<string, ParsedClaim[]>,
  currentMoveset: string[],
  vaultPath: string,
): Promise<MovesetSuggestion[]> {
  const moveTags = new Map<string, Set<string>>();
  for (const moveId of currentMoveset) {
    const skillPath = path.join(vaultPath, "wikis", "_agents", "moves", moveId, "SKILL.md");
    try {
      const raw = await fs.readFile(skillPath, "utf8");
      const { data } = matter(raw);
      const tags = new Set<string>([
        ...(((data?.tags as string[] | undefined) ?? [])),
        ...(((data?.applies_to as string[] | undefined) ?? [])),
      ]);
      moveTags.set(moveId, tags);
    } catch {
      // Missing or unreadable SKILL.md → covers nothing.
      moveTags.set(moveId, new Set());
    }
  }

  const out: MovesetSuggestion[] = [];
  for (const [tag, claims] of clusters) {
    const covered = [...moveTags.values()].some((s) => s.has(tag));
    if (covered) continue;
    const sortedByConfidence = [...claims].sort(
      (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0),
    );
    out.push({
      move_hint: `move-${tag}-handler`,
      tag_cluster: [tag],
      claim_count: claims.length,
      example_claim_ids: sortedByConfidence.slice(0, 3).map((c) => c.id),
    });
  }
  return out;
}

// ---------- renderRationale ----------

/**
 * Contract: this helper is a string-formatter only. It does NOT inspect the
 * moveset, sidecar, or any state — every value rendered comes from the
 * input.
 *
 * The ORCHESTRATOR (task-evolution-orchestrator) decides:
 *   - which clusters appear in `topClusters` (typically all surviving
 *     clusters, sorted by claim_count desc, capped at 3)
 *   - which moves appear in `uncoveredMoveHints` (the move_hint values from
 *     `suggestMoves` output — i.e., clusters whose tag is NOT covered by
 *     any existing moveset member's tags/applies_to)
 *   - which claim ids appear in `topEvidenceClaimIds` (up to 3 claims with
 *     highest effective confidence across all surviving clusters)
 *
 * The helper never decides "should I emit the consider-authoring line" — it
 * emits the line iff `uncoveredMoveHints` is non-empty.
 */
export interface RationaleInput {
  profileId: string;
  totalActive: number;
  aboveThreshold: number;
  renderMinConfidence: number;
  eligibility: EligibilityReport;
  currentStage: string;
  topClusters: Array<{ tag: string; count: number }>;
  uncoveredMoveHints: string[];
  topEvidenceClaimIds: string[];
}

// ---------- clusterWeight ----------
//
// T5 of the specialist-agent-substrate DAG (spec §5.4). Per-cluster
// weighted aggregation:
//
//   cluster_weight = sum_over_claims(effective_confidence × source_type_weight)
//
// Where source_type_weight is `weights[claim.source_type ?? "lived"]`. The
// back-compat default of `lived` matches the zod default in
// `types/claim.ts:Base.source_type` so claims authored before T1 (which
// have no source_type field on disk but parse with `lived` via zod) are
// weighted at the lived rate.
//
// Decay parameters mirror `loadActiveProfileClaims`'s effective-confidence
// call so weights are applied to the same (decayed) per-claim confidence
// the rest of the orchestrator already uses for rendering / suggestion.
// `computeEligibility` (the task-count eligibility gate) does NOT consult
// this function — its inputs are unchanged. Per spec §5.4, weights affect
// specialty-cluster identification and rationale ONLY.

export interface ClusterWeightDecayConfig {
  half_life_days: number;
  effective_floor: number;
}

/**
 * Compute the source-type-weighted cluster_weight for one bucket of claims.
 * Pure (modulo the injected `today` date); never reads the clock.
 *
 * Each claim contributes `effective_confidence(c, today, decay) × weight`
 * where `weight = weights[c.source_type ?? "lived"]`. Sum over the bucket.
 */
export function clusterWeight(
  claims: ParsedClaim[],
  weights: SourceTypeWeights,
  today: Date,
  decay: ClusterWeightDecayConfig,
): number {
  let total = 0;
  for (const c of claims) {
    const eff = effectiveConfidence(
      { confidence: c.confidence, last_validated: c.last_validated, status: c.status },
      today,
      decay,
    );
    const w = weights[(c.source_type ?? "lived") as keyof SourceTypeWeights];
    total += eff * w;
  }
  return total;
}

export function renderRationale(input: RationaleInput): string {
  const lines: string[] = [];
  lines.push(
    `Profile ${input.profileId} has authored ${input.totalActive} active claims, of which ${input.aboveThreshold} exceed the ${input.renderMinConfidence} effective-confidence threshold. Eligibility check: ${input.eligibility.eligible ? "eligible" : "not eligible"} for ${input.currentStage}.`,
  );
  if (input.topClusters.length > 0) {
    const fmt = input.topClusters.map((c) => `${c.tag} (${c.count})`).join(", ");
    lines.push(`Top tag clusters: ${fmt}.`);
  }
  if (input.uncoveredMoveHints.length > 0) {
    const hints = input.uncoveredMoveHints.join(", ");
    lines.push(
      `The cluster(s) above are not yet covered by the current moveset — consider authoring ${hints}.`,
    );
  }
  if (input.topEvidenceClaimIds.length > 0) {
    const cites = input.topEvidenceClaimIds.map((id) => `[[${id}]]`).join(", ");
    lines.push(`Top evidence: ${cites}.`);
  }
  return lines.join("\n\n");
}
