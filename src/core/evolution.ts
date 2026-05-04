import {
  EvolutionStage,
  AutonomyLevel,
  PokemonType,
  nextStage,
  meetsThreshold,
  defaultAutonomyForStage,
  thresholdFor
} from "./pokemon.js";
import type { EvolutionThresholds } from "./thresholds.js";
import { clusterByTag, loadActiveProfileClaims } from "./claim-clustering.js";
import {
  computeEligibility,
  suggestMoves,
  renderRationale,
  type EligibilityReport,
  type MovesetSuggestion,
} from "./evolution-claims.js";
import { effectiveConfidence } from "./decay.js";
import { getClaimsConfig, type ClaimsConfig } from "../config.js";

export interface ProfileForProposal {
  id: string;
  title: string;
  pokemon_type: PokemonType | string;
  evolution_stage: EvolutionStage;
  autonomy_level: AutonomyLevel | string;
  moveset: string[];
  created: string;
}

export interface StatsForProposal {
  tasks_completed: number;
  tasks_failed: number;
  success_rate: number;
  moves_used_freq: Record<string, number>;
}

export interface EvolutionProposalCurrent {
  name: string;
  evolution_stage: EvolutionStage;
  moveset: string[];
  autonomy_level: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Claims Plan 2 — additive output shapes. The legacy v1.5 fields above this
// fence stay shape-stable; the new fields below land on the proposal
// alongside them. When the orchestrator is invoked without a `vaultPath`
// the new fields default to empty/zero defaults — see proposeEvolution()
// below for the back-compat path.
// ─────────────────────────────────────────────────────────────────────────

export interface SpecialtyEntry {
  tag: string;
  claim_count: number;
}

export interface EvidenceSummary {
  total_active_claims: number;
  above_threshold_count: number;
  superseded_count: number;
  top_clusters: Array<{ tag: string; count: number }>;
}

export interface EvolutionProposalProposed {
  name: string | null;
  evolution_stage: EvolutionStage;
  moveset_additions: string[];
  moveset_removals: string[];
  autonomy_level: AutonomyLevel;
  // Plan 2 additions — populated regardless of the vaultPath presence; default
  // to [] when claims integration is skipped.
  specialties: SpecialtyEntry[];
  moveset_suggestions: MovesetSuggestion[];
}

export interface EvolutionProposal {
  // ── v1.5 fields (shape-stable) ─────────────────────────────────────────
  eligible: boolean;
  reason?: string;
  current: EvolutionProposalCurrent;
  proposed: EvolutionProposalProposed;
  rationale: string;
  // ── Plan 2 additions ───────────────────────────────────────────────────
  // The new claim-driven `eligibility` block is ADVISORY and ADDITIVE; the
  // top-level `eligible` field above stays driven by the v1.5 stats
  // pathway (tasks_completed + success_rate vs. thresholds). Consumers can
  // surface either or both.
  eligibility: EligibilityReport;
  evidence_summary: EvidenceSummary;
}

const MOVESET_ADDITION_THRESHOLD = 10;
const MOVESET_ADDITION_CAP = 2;

// Frozen module-level singletons returned by reference from the legacy
// (no-vaultPath) code path. Freezing is defensive: in a long-running MCP
// server, a caller that mutated `out.eligibility.eligible = true` or
// `out.evidence_summary.top_clusters.push(...)` would silently corrupt
// these constants for every subsequent call. With Object.freeze, such
// mutations throw in strict mode (which ES modules use by default).
const EMPTY_EVIDENCE_SUMMARY: EvidenceSummary = Object.freeze({
  total_active_claims: 0,
  above_threshold_count: 0,
  superseded_count: 0,
  top_clusters: Object.freeze([]) as [],
}) as unknown as EvidenceSummary;

const SKIPPED_ELIGIBILITY: EligibilityReport = Object.freeze({
  eligible: false,
  reason: "claims integration skipped (no vaultPath)",
  high_confidence_claim_count: 0,
  threshold: 0,
}) as EligibilityReport;

export interface ProposeEvolutionInput {
  profile: ProfileForProposal;
  stats: StatsForProposal;
  memory_page_id?: string;
  thresholds?: EvolutionThresholds;
  // Plan 2 additions — all optional; supplying `vaultPath` enables the
  // claim-driven extensions. `today` is required when `vaultPath` is set
  // (the orchestrator never reads `Date.now()`); if omitted it defaults to
  // the current date — but `today` SHOULD be injected by callers who want
  // deterministic outputs (the unit suite always injects).
  vaultPath?: string;
  today?: Date;
  claimsConfig?: ClaimsConfig;
}

// Synchronous overload for the legacy back-compat path (no vaultPath supplied).
export function proposeEvolution(input: ProposeEvolutionInput & { vaultPath?: undefined }): EvolutionProposal;
// Async overload for the claims-integrated path.
export function proposeEvolution(input: ProposeEvolutionInput & { vaultPath: string }): Promise<EvolutionProposal>;
export function proposeEvolution(input: ProposeEvolutionInput): EvolutionProposal | Promise<EvolutionProposal> {
  const legacy = computeLegacyProposal(input);
  if (!input.vaultPath) {
    // Back-compat: no claims integration; return v1.5 shape with empty
    // additive fields.
    return {
      ...legacy,
      proposed: {
        ...legacy.proposed,
        specialties: [],
        moveset_suggestions: [],
      },
      eligibility: SKIPPED_ELIGIBILITY,
      evidence_summary: EMPTY_EVIDENCE_SUMMARY,
    };
  }
  return enrichWithClaims(input as ProposeEvolutionInput & { vaultPath: string }, legacy);
}

// ─────────────────────────────────────────────────────────────────────────
// Internal: split the v1.5 logic out so both paths reuse it. The shape it
// returns matches the pre-Plan-2 `EvolutionProposal` (no `specialties`, no
// `moveset_suggestions` on `proposed`; no top-level `eligibility` /
// `evidence_summary`). Both call sites layer the additive fields on top.
// ─────────────────────────────────────────────────────────────────────────

interface LegacyProposal {
  eligible: boolean;
  reason?: string;
  current: EvolutionProposalCurrent;
  proposed: {
    name: string | null;
    evolution_stage: EvolutionStage;
    moveset_additions: string[];
    moveset_removals: string[];
    autonomy_level: AutonomyLevel;
  };
  rationale: string;
}

function computeLegacyProposal(input: ProposeEvolutionInput): LegacyProposal {
  const { profile, stats } = input;

  // Resolve effective thresholds. When `thresholds` is supplied (v1.6 §4.4),
  // it overrides the hard-coded defaults that `meetsThreshold`/`thresholdFor`
  // pull from `pokemon.ts`. The override is local to this proposal — the
  // shared `pokemon.ts` table is unchanged, so other callers still see v1.5
  // defaults.
  function effectiveThreshold(transition: "basic-to-stage1" | "stage1-to-stage2"): { tasks_completed: number; success_rate: number } {
    if (input.thresholds) {
      return transition === "basic-to-stage1"
        ? input.thresholds.basic_to_stage1
        : input.thresholds.stage1_to_stage2;
    }
    return thresholdFor(transition);
  }
  function effectiveMeetsThreshold(stage: EvolutionStage, s: { tasks_completed: number; success_rate: number }): boolean {
    const nx = nextStage(stage);
    if (nx === null) return false;
    const t = effectiveThreshold(`${stage}-to-${nx}` as "basic-to-stage1" | "stage1-to-stage2");
    return s.tasks_completed >= t.tasks_completed && s.success_rate >= t.success_rate;
  }

  const current: EvolutionProposalCurrent = {
    name: profile.title,
    evolution_stage: profile.evolution_stage,
    moveset: profile.moveset,
    autonomy_level: String(profile.autonomy_level)
  };

  const next = nextStage(profile.evolution_stage);
  if (next === null) {
    return {
      eligible: false,
      reason: "already at stage2 — no further evolution available",
      current,
      proposed: {
        name: null,
        evolution_stage: profile.evolution_stage,
        moveset_additions: [],
        moveset_removals: [],
        autonomy_level: defaultAutonomyForStage(profile.evolution_stage)
      },
      rationale: "stage2 is the maximum evolution stage in v1.5"
    };
  }

  if (!effectiveMeetsThreshold(profile.evolution_stage, stats)) {
    const transition = `${profile.evolution_stage}-to-${next}` as "basic-to-stage1" | "stage1-to-stage2";
    const t = effectiveThreshold(transition);
    const tasksGap = Math.max(0, t.tasks_completed - stats.tasks_completed);
    const reasonParts: string[] = [];
    if (stats.tasks_completed < t.tasks_completed) {
      reasonParts.push(`needs ${tasksGap} more completed tasks (have ${stats.tasks_completed}, need ${t.tasks_completed})`);
    }
    if (stats.success_rate < t.success_rate) {
      reasonParts.push(`success_rate ${stats.success_rate.toFixed(2)} below ${t.success_rate.toFixed(2)} threshold`);
    }
    return {
      eligible: false,
      reason: reasonParts.join("; ") || `tasks_completed/success_rate below thresholds for ${transition}`,
      current,
      proposed: {
        name: null,
        evolution_stage: next,
        moveset_additions: [],
        moveset_removals: [],
        autonomy_level: defaultAutonomyForStage(next)
      },
      rationale: `not yet eligible for ${profile.evolution_stage} → ${next}`
    };
  }

  // Eligible — compute moveset additions and removals
  const currentMoveset = new Set(profile.moveset);
  const additionCandidates = Object.entries(stats.moves_used_freq)
    .filter(([id, freq]) => !currentMoveset.has(id) && freq >= MOVESET_ADDITION_THRESHOLD)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MOVESET_ADDITION_CAP)
    .map(([id]) => id);

  const removalCandidates = profile.moveset.filter(id => (stats.moves_used_freq[id] ?? 0) === 0);

  const t = effectiveThreshold(`${profile.evolution_stage}-to-${next}` as "basic-to-stage1" | "stage1-to-stage2");
  const baseRationale = `eligible for ${profile.evolution_stage} → ${next}: ${stats.tasks_completed} tasks completed at ${stats.success_rate.toFixed(2)} success rate (threshold: ${t.tasks_completed} tasks, ${t.success_rate.toFixed(2)} rate)`;
  const rationale = input.memory_page_id
    ? `${baseRationale}; memory: [[${input.memory_page_id}]]`
    : baseRationale;

  return {
    eligible: true,
    current,
    proposed: {
      name: null,  // C.1a deterministic — no PokeAPI yet
      evolution_stage: next,
      moveset_additions: additionCandidates,
      moveset_removals: removalCandidates,
      autonomy_level: defaultAutonomyForStage(next)
    },
    rationale
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Internal: claim-driven extension (Plan 2 §8.1). Loads active claims for
// the profile, clusters them by tag, computes specialties / moveset
// suggestions / eligibility / evidence summary, and replaces the rationale
// with the multi-line claim-aware version. The v1.5 top-level `eligible`
// stays as-is for back-compat — the new `eligibility` block is advisory.
// ─────────────────────────────────────────────────────────────────────────

async function enrichWithClaims(
  input: ProposeEvolutionInput & { vaultPath: string },
  legacy: LegacyProposal,
): Promise<EvolutionProposal> {
  const today = input.today ?? new Date();
  const config = input.claimsConfig ?? getClaimsConfig({});

  const claims = await loadActiveProfileClaims(
    input.vaultPath,
    input.profile.id,
    today,
    config,
  );
  const clusters = clusterByTag(claims, config.specialty_min_cluster);

  // Specialties: one entry per surviving cluster; preserve insertion order
  // here so downstream consumers see the same ordering as the cluster map.
  // (`evidence_summary.top_clusters` separately sorts by count desc.)
  const specialties: SpecialtyEntry[] = [...clusters.entries()].map(
    ([tag, arr]) => ({ tag, claim_count: arr.length }),
  );

  const moveset_suggestions = await suggestMoves(
    clusters,
    input.profile.moveset,
    input.vaultPath,
  );

  const eligibility = computeEligibility(
    claims.length,
    input.profile.evolution_stage,
    {
      stage1: config.evolution_thresholds.stage1,
      stage2: config.evolution_thresholds.stage2,
    },
  );

  // top_clusters: top 3 by claim_count desc. Stable secondary sort by tag
  // string so ties are reproducible.
  const top_clusters = [...specialties]
    .sort((a, b) => b.claim_count - a.claim_count || a.tag.localeCompare(b.tag))
    .slice(0, 3)
    .map((s) => ({ tag: s.tag, count: s.claim_count }));

  const evidence_summary: EvidenceSummary = {
    total_active_claims: claims.length,
    // After loadActiveProfileClaims, every claim is at-or-above the
    // render_min_confidence floor — so above_threshold_count equals the
    // total. (A future expansion could distinguish floor vs. eligibility
    // thresholds; today the loader has already filtered.)
    above_threshold_count: claims.length,
    // Plan 2 reference snippet leaves the superseded count to a sidecar
    // walk; the current loader filters superseded out, so this field
    // remains 0 until a sidecar pass lands. Defaulting to 0 is the
    // documented fallback.
    superseded_count: 0,
    top_clusters,
  };

  // Top evidence: 3 highest-effective-confidence claims across surviving
  // clusters. Use the cluster output (not raw claims) so a claim only
  // counts once even if it carries multiple surviving tags.
  const seen = new Set<string>();
  const survivors: typeof claims = [];
  for (const arr of clusters.values()) {
    for (const c of arr) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      survivors.push(c);
    }
  }
  const topEvidenceIds = survivors
    .map((c) => ({
      id: c.id,
      eff: effectiveConfidence(
        { confidence: c.confidence, last_validated: c.last_validated, status: c.status },
        today,
        {
          half_life_days: config.half_life_days,
          effective_floor: config.effective_floor,
        },
      ),
    }))
    .sort((a, b) => b.eff - a.eff || a.id.localeCompare(b.id))
    .slice(0, 3)
    .map((x) => x.id);

  const uncoveredMoveHints = moveset_suggestions.map((s) => s.move_hint);

  const claimRationale = renderRationale({
    profileId: input.profile.id,
    totalActive: claims.length,
    aboveThreshold: claims.length,
    renderMinConfidence: config.render_min_confidence,
    eligibility,
    currentStage: input.profile.evolution_stage,
    topClusters: top_clusters,
    uncoveredMoveHints,
    topEvidenceClaimIds: topEvidenceIds,
  });

  return {
    eligible: legacy.eligible,
    reason: legacy.reason,
    current: legacy.current,
    proposed: {
      ...legacy.proposed,
      specialties,
      moveset_suggestions,
    },
    rationale: claimRationale,
    eligibility,
    evidence_summary,
  };
}
