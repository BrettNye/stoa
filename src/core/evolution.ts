import {
  EvolutionStage,
  AutonomyLevel,
  PokemonType,
  nextStage,
  meetsThreshold,
  defaultAutonomyForStage,
  thresholdFor
} from "./pokemon.js";

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

export interface EvolutionProposalProposed {
  name: string | null;
  evolution_stage: EvolutionStage;
  moveset_additions: string[];
  moveset_removals: string[];
  autonomy_level: AutonomyLevel;
}

export interface EvolutionProposal {
  eligible: boolean;
  reason?: string;
  current: EvolutionProposalCurrent;
  proposed: EvolutionProposalProposed;
  rationale: string;
}

const MOVESET_ADDITION_THRESHOLD = 10;
const MOVESET_ADDITION_CAP = 2;

export function proposeEvolution(input: { profile: ProfileForProposal; stats: StatsForProposal }): EvolutionProposal {
  const { profile, stats } = input;

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

  if (!meetsThreshold(profile.evolution_stage, stats)) {
    const transition = `${profile.evolution_stage}-to-${next}` as "basic-to-stage1" | "stage1-to-stage2";
    const t = thresholdFor(transition);
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

  const t = thresholdFor(`${profile.evolution_stage}-to-${next}` as "basic-to-stage1" | "stage1-to-stage2");
  const rationale = `eligible for ${profile.evolution_stage} → ${next}: ${stats.tasks_completed} tasks completed at ${stats.success_rate.toFixed(2)} success rate (threshold: ${t.tasks_completed} tasks, ${t.success_rate.toFixed(2)} rate)`;

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
