import type { PokemonType, EvolutionStage, AutonomyLevel } from "./frontmatter.js";

export const POKEMON_TYPES: readonly PokemonType[] = [
  "normal", "fire", "water", "electric", "grass", "ice", "fighting",
  "poison", "ground", "flying", "psychic", "bug", "rock", "ghost",
  "dragon", "dark", "steel", "fairy"
] as const;

/**
 * v1.5 spec §7.1 — opinionated dev-specialty mapping.
 * Users can override per-profile; this is the default suggestion mapping.
 */
export const DEV_SPECIALTY_TO_TYPE: Record<string, PokemonType> = {
  "backend":         "fire",
  "frontend":        "water",
  "realtime":        "electric",
  "events":          "electric",
  "research":        "grass",
  "docs":            "grass",
  "infrastructure":  "steel",
  "build":           "steel",
  "ci":              "steel",
  "tests":           "ghost",
  "qa":              "ghost",
  "orchestration":   "psychic",
  "coordination":    "psychic",
  "fullstack":       "dragon",
  "security":        "dark",
  "audit":           "dark",
  "design":          "fairy",
  "ux":              "fairy",
  "refactoring":     "fighting",
  "code-review":     "fighting",
  "caching":         "ice",
  "perf":            "ice",
  "data":            "rock",
  "db":              "rock",
  "devops":          "ground",
  "deployment":      "ground",
  "apis":            "flying",
  "integrations":    "flying",
  "debugging":       "bug",
  "forensics":       "bug",
  "general":         "normal",
  "legacy":          "poison",
  "deletion":        "poison",
  "migration":       "poison"
};

export const TYPE_TO_DEV_SPECIALTY: Record<PokemonType, string> = (() => {
  const out: Partial<Record<PokemonType, string>> = {};
  for (const [specialty, type] of Object.entries(DEV_SPECIALTY_TO_TYPE)) {
    if (!out[type]) out[type] = specialty; // first wins for primary specialty
  }
  return out as Record<PokemonType, string>;
})();

export interface EvolutionThreshold {
  tasks_completed: number;
  success_rate: number;
}

export const EVOLUTION_THRESHOLDS: Record<Exclude<EvolutionStage, "basic">, EvolutionThreshold> = {
  stage1: { tasks_completed: 30, success_rate: 0.80 },
  stage2: { tasks_completed: 100, success_rate: 0.85 }
};

export const STAGE_TO_AUTONOMY: Record<EvolutionStage, AutonomyLevel> = {
  basic:  "restricted",
  stage1: "feature-branch",
  stage2: "main-branch"
};
