// Canonical 18 Pokemon types per the official games.
export const POKEMON_TYPES = [
  "normal", "fire", "water", "electric", "grass", "ice",
  "fighting", "poison", "ground", "flying", "psychic", "bug",
  "rock", "ghost", "dragon", "dark", "steel", "fairy"
] as const;

export type PokemonType = typeof POKEMON_TYPES[number];

export function isValidPokemonType(t: string): t is PokemonType {
  return (POKEMON_TYPES as readonly string[]).includes(t);
}

// Spec §7.1 — opinionated dev-specialty → pokemon-type mapping.
// Default to "normal" for unknown specialties.
export const DEV_SPECIALTY_TO_TYPE: Record<string, PokemonType> = {
  backend: "fire",
  "processing-heavy": "fire",
  frontend: "water",
  ui: "water",
  realtime: "electric",
  events: "electric",
  streaming: "electric",
  research: "grass",
  docs: "grass",
  synthesis: "grass",
  infrastructure: "steel",
  build: "steel",
  ci: "steel",
  tests: "ghost",
  qa: "ghost",
  orchestration: "psychic",
  coordination: "psychic",
  "full-stack": "dragon",
  security: "dark",
  audit: "dark",
  design: "fairy",
  ux: "fairy",
  refactoring: "fighting",
  "code-review": "fighting",
  caching: "ice",
  perf: "ice",
  data: "rock",
  db: "rock",
  devops: "ground",
  deployment: "ground",
  apis: "flying",
  integrations: "flying",
  debugging: "bug",
  forensics: "bug",
  legacy: "poison",
  migration: "poison"
};

export const TYPE_TO_DEV_SPECIALTY: Record<PokemonType, string> = (() => {
  const out: Partial<Record<PokemonType, string>> = {};
  for (const [specialty, type] of Object.entries(DEV_SPECIALTY_TO_TYPE)) {
    if (!out[type]) out[type] = specialty;
  }
  return out as Record<PokemonType, string>;
})();

export function mapDevSpecialty(specialty: string): PokemonType {
  return DEV_SPECIALTY_TO_TYPE[specialty.toLowerCase()] ?? "normal";
}

export type EvolutionStage = "basic" | "stage1" | "stage2";
export type AutonomyLevel = "restricted" | "feature-branch" | "main-branch";

export const STAGE_TO_AUTONOMY: Record<EvolutionStage, AutonomyLevel> = {
  basic: "restricted",
  stage1: "feature-branch",
  stage2: "main-branch"
};

export function defaultAutonomyForStage(stage: EvolutionStage): AutonomyLevel {
  return STAGE_TO_AUTONOMY[stage];
}

export function nextStage(stage: EvolutionStage): EvolutionStage | null {
  if (stage === "basic") return "stage1";
  if (stage === "stage1") return "stage2";
  return null;
}

export type EvolutionTransition = "basic-to-stage1" | "stage1-to-stage2";

export interface EvolutionThreshold {
  tasks_completed: number;
  success_rate: number;
}

const THRESHOLDS: Record<EvolutionTransition, { tasks_completed: number; success_rate: number }> = {
  "basic-to-stage1": { tasks_completed: 30, success_rate: 0.80 },
  "stage1-to-stage2": { tasks_completed: 100, success_rate: 0.85 }
};

export const EVOLUTION_THRESHOLDS: Record<Exclude<EvolutionStage, "basic">, EvolutionThreshold> = {
  stage1: { tasks_completed: 30, success_rate: 0.80 },
  stage2: { tasks_completed: 100, success_rate: 0.85 }
};

export function thresholdFor(transition: EvolutionTransition): { tasks_completed: number; success_rate: number } {
  return THRESHOLDS[transition];
}

export function meetsThreshold(
  currentStage: EvolutionStage,
  stats: { tasks_completed: number; success_rate: number }
): boolean {
  const next = nextStage(currentStage);
  if (next === null) return false;
  const transition = `${currentStage}-to-${next}` as EvolutionTransition;
  const t = THRESHOLDS[transition];
  return stats.tasks_completed >= t.tasks_completed && stats.success_rate >= t.success_rate;
}
