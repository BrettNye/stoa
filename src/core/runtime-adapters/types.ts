// v1.7 §6.1 + §6.3 — Cross-runtime deployment contract types.
//
// SubagentIntent is the runtime-agnostic source of truth derived from a
// profile + its moveset. RuntimeAdapter is the interface every per-runtime
// adapter implements (validate / serialize / deploy / verify / remove).
//
// v1.7 ships one runtime (claude-code); v1.8 will add openclaw. Adding a
// new runtime extends RuntimeName + registers a new adapter, no changes
// to SubagentIntent or DeploymentEntry required (§6.7).

export type RuntimeName = "claude-code"; // v1.8: | "openclaw"

export type ToolName = string;  // e.g. "vault.task-claim", "Bash", "WebSearch"

// Mirror of POKEMON_TYPES from core/pokemon.ts; widened here to avoid a
// circular import. Validated structurally at intent-build time.
export type PokemonType = string;

export type EvolutionStage = "basic" | "stage1" | "stage2";
export type ModelTier = "opus" | "sonnet" | "haiku" | "inherit";
export type WorktreeIsolation = "recommended" | "optional" | "required";

export interface MoveReference {
  id: string;          // move-id (e.g. "move-tdd-cycle")
  title: string;
  summary: string;
  applicability: string;  // "Use when X" guidance from SKILL.md
}

export interface SubagentIntent {
  id: string;                          // = profile-id, e.g. "profile-charmander"
  pokemon_name: string;                // bare name, lowercased
  pokemon_type: PokemonType;
  evolution_stage: EvolutionStage;
  routing_description: string;         // single-line; from `subagent_description:` or `summary`
  system_prompt: string;               // long-form character + role guidance (from profile body)
  moveset: MoveReference[];
  tools_allowlist: ToolName[];
  model_tier: ModelTier;
  worktree_isolation: WorktreeIsolation;
  applies_to: RuntimeName[];
  generated_at: string;                // ISO timestamp; serialization metadata only
  source_revision: string;             // git rev — canonical determinism key
}

export type SerializedFiles = Record<string, string>;  // relative-path → content

export interface ValidationResult {
  ok: boolean;
  errors: ValidationDiagnostic[];      // hard fails (invariants 1-5)
  warnings: ValidationDiagnostic[];    // soft fails (invariant 6: permission conflicts)
}

export interface ValidationDiagnostic {
  invariant: number;                   // 1..6 per §6.4
  message: string;
  context?: Record<string, unknown>;   // structured details (e.g. conflicting tool names)
}

export interface DeployOptions {
  mode: "copy" | "symlink";            // matches sync-skills semantics
  overwrite: boolean;
  registry_path: string;               // vault path; entry recorded under _index/deployments.json
}

export interface DeployResult {
  files_written: string[];             // absolute paths
  status: "deployed" | "skipped-no-change";
  source_revision: string;
}

export interface VerifyResult {
  ok: boolean;
  violations: ValidationDiagnostic[];  // re-runs invariants 1-5 against on-disk artifact
}

export interface RemoveResult {
  files_removed: string[];             // absolute paths
}

export interface RuntimeAdapter {
  readonly name: RuntimeName;
  validate(intent: SubagentIntent, target: string): Promise<ValidationResult>;
  serialize(intent: SubagentIntent): SerializedFiles;
  deploy(intent: SubagentIntent, target: string, opts: DeployOptions): Promise<DeployResult>;
  verify(intent: SubagentIntent, target: string): Promise<VerifyResult>;
  remove(intent: SubagentIntent, target: string): Promise<RemoveResult>;
}

export class UnknownRuntimeError extends Error {
  constructor(public runtime: string) {
    super(`unknown runtime: ${runtime}`);
    this.name = "UnknownRuntimeError";
  }
}
