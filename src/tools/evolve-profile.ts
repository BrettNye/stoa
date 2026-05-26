import { z } from "zod";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { proposeEvolution } from "../core/evolution.js";
import { ProfileNotFoundError } from "../core/profiles.js";
import { recordRename } from "../core/aliases.js";
import { profileStatsTool } from "./profile-stats.js";
import { parseFrontmatter, serializeFrontmatter } from "../core/frontmatter.js";
import { EvolutionStage } from "../core/pokemon.js";
import { readDeployments, migrateDeploymentKey } from "../core/deployments.js";
import { syncMoveset, removeOldDeployment } from "../core/skills.js";
import { nextEvolution } from "../core/pokeapi.js";
import { readThresholds, DEFAULT_THRESHOLDS, ThresholdBlockError, type EvolutionThresholds } from "../core/thresholds.js";
import { getClaimsConfig } from "../config.js";
import { resolveTrainerContext, type TrainerContext } from "../core/resolve-trainer-context.js";
import type { ToolScope } from "../auth/types.js";

// ─────────────────────────────────────────────────────────────────────────
// Wiki-scoped profile reader: reads the profile from wikis/<wiki>/profiles/<id>.md
// instead of the _agents-hardcoded readProfile helper in core/profiles.ts.
// This is required so the wiki: arg routes correctly (synthesis A2 fix).
// ─────────────────────────────────────────────────────────────────────────
function readProfileFromWiki(
  vaultPath: string,
  wiki: string,
  id: string
): { frontmatter: Record<string, any>; body: string; updated: string; path: string } {
  const profilePath = join(vaultPath, "wikis", wiki, "profiles", `${id}.md`);
  if (!existsSync(profilePath)) {
    throw new ProfileNotFoundError(id);
  }
  const raw = readFileSync(profilePath, "utf8");
  const { frontmatter, body } = parseFrontmatter(raw);
  return {
    frontmatter,
    body,
    path: profilePath,
    updated: String(frontmatter.updated ?? frontmatter.created ?? "")
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Claims Plan 2 Wave 3 (task-evolve-profile-tool-fields): additive
// ProposalShape extensions. The orchestrator (`core/evolution.ts`) now
// returns four extra fields on the proposal whenever `vaultPath` is
// supplied: `proposed.specialties`, `proposed.moveset_suggestions`, the
// top-level advisory `eligibility` block, and `evidence_summary`. The
// tool's input schema must accept those when echoed back on commit:true,
// while staying compatible with v1.5-shape callers that omit them
// (additive defaults at the schema level).
//
// Commit semantics are unchanged: the new fields are present-but-ignored
// when applying frontmatter changes — only `proposed.evolution_stage`,
// `autonomy_level`, `moveset_additions`/`removals`, and `name` affect the
// profile file.
// ─────────────────────────────────────────────────────────────────────────

const SpecialtyEntry = z.object({
  tag: z.string(),
  claim_count: z.number().int().nonnegative()
});

const MovesetSuggestion = z.object({
  move_hint: z.string(),
  tag_cluster: z.array(z.string()),
  claim_count: z.number().int().nonnegative(),
  example_claim_ids: z.array(z.string())
});

const EligibilityReport = z.object({
  eligible: z.boolean(),
  reason: z.string(),
  high_confidence_claim_count: z.number().int().nonnegative(),
  threshold: z.number().int().nonnegative()
});

const EvidenceSummary = z.object({
  total_active_claims: z.number().int().nonnegative(),
  above_threshold_count: z.number().int().nonnegative(),
  superseded_count: z.number().int().nonnegative(),
  top_clusters: z.array(z.object({ tag: z.string(), count: z.number().int().nonnegative() }))
});

const ProposedShape = z.object({
  name: z.string().nullable(),
  evolution_stage: z.enum(["basic", "stage1", "stage2"]),
  moveset_additions: z.array(z.string()),
  moveset_removals: z.array(z.string()),
  autonomy_level: z.enum(["restricted", "feature-branch", "main-branch"]),
  // additive — defaults handle legacy v1.5-shape callers
  moveset_suggestions: z.array(MovesetSuggestion).default([]),
  specialties: z.array(SpecialtyEntry).default([])
});

const ProposalShape = z.object({
  eligible: z.boolean(),
  reason: z.string().optional(),
  current: z.object({
    name: z.string(),
    evolution_stage: z.enum(["basic", "stage1", "stage2"]),
    moveset: z.array(z.string()),
    // `current.autonomy_level` is intentionally `z.string()` (not the
    // enum used on `proposed.autonomy_level`) — live profiles may carry
    // legacy values that predate the v1.5 enum normalization.
    autonomy_level: z.string()
  }),
  proposed: ProposedShape,
  rationale: z.string(),
  // additive Plan 2 advisory blocks
  eligibility: EligibilityReport.optional(),
  evidence_summary: EvidenceSummary.optional()
});

// Flat z.object so zodToJsonSchema produces type:"object" compatible with MCP SDK.
// commit:true fields are optional at the schema level; runtime validates them.
//
// `cleanup_old_skills_dir` (v1.6 §6.3) defaults to true: when a commit-phase
// rename occurs, the pre-rename per-deployment skills directory is removed
// before re-deploying under the new bare name. Pass `false` to leave the old
// dir on disk (e.g. for a manual side-by-side review during evolution).
const Input = z.object({
  pokemon_id: z.string(),
  commit: z.boolean().default(false),
  expected_updated: z.string().optional(),
  proposal: ProposalShape.optional(),
  cleanup_old_skills_dir: z.boolean().default(true),
  wiki: z.string().optional()
});

const evolveProfileScope: ToolScope = {
  axis: (input: any) => {
    const wiki = (input as any).wiki;
    const pokemonId = (input as any).pokemon_id;
    return `wikis/${wiki ?? "*"}/profiles/${pokemonId ?? "*"}`;
  },
  adminOnly: () => true,
};

export const evolveProfileTool = {
  name: "vault_evolve-profile",
  description: "Two-phase profile evolution. commit:false returns a proposal (eligible? proposed shape, rationale). commit:true applies the proposal, optionally renaming the profile.",
  inputSchema: Input,
  scope: evolveProfileScope,
  handler: async (
    input: z.infer<typeof Input>,
    ctx: {
      vaultPath: string;
      fetcher?: typeof fetch;
      // Plan 2 Wave 3 — clock injection + raw vault config pass-through.
      // Both optional so DispatchCtx (which carries an optional rawConfig)
      // is structurally assignable. `today` defaults to `new Date()` when
      // omitted; tests should always inject for deterministic outputs.
      today?: Date;
      rawConfig?: unknown;
    }
  ) => {
    // Resolve trainer context for ambient caller_trainer_id and wiki routing.
    // If explicit wiki: arg is provided, trainer resolution is best-effort only.
    // If no explicit wiki: arg, any TrainerContextError propagates — no fallback.
    const parsedInput = Input.parse(input);
    let trainerCtx: TrainerContext | undefined;
    if (!parsedInput.wiki) {
      trainerCtx = resolveTrainerContext({}, { vaultPath: ctx.vaultPath });
    } else {
      try {
        trainerCtx = resolveTrainerContext({}, { vaultPath: ctx.vaultPath });
      } catch {
        trainerCtx = undefined;
      }
    }
    const wiki = parsedInput.wiki ?? trainerCtx?.wiki;
    if (!wiki) throw new Error("wiki resolution failed: no explicit arg and no resolved trainer context");

    if (!input.commit) {
      // Proposal phase
      const profile = readProfileFromWiki(ctx.vaultPath, wiki, input.pokemon_id);
      const stats = await profileStatsTool.handler({ pokemon_id: input.pokemon_id, wiki: parsedInput.wiki }, ctx);

      // Look up per-agent memory synthesis if present (Plan C.1b)
      const bare = input.pokemon_id.startsWith("profile-")
        ? input.pokemon_id.slice("profile-".length)
        : input.pokemon_id;
      const memoryPath = join(ctx.vaultPath, "wikis", "_agents", "synthesis", `synthesis-${bare}-memory.md`);
      const memoryPageId = existsSync(memoryPath) ? `synthesis-${bare}-memory` : undefined;

      // Resolve evolution thresholds per v1.6 §4.4 / §7.3.
      // Missing or absent block → defaults. Invalid block (ThresholdBlockError)
      // → also defaults; lint reports the invalid block separately
      // (THRESHOLD_BLOCK_INVALID, §6 lint registry).
      let thresholds: EvolutionThresholds;
      try {
        thresholds = readThresholds(ctx.vaultPath) ?? DEFAULT_THRESHOLDS;
      } catch (err) {
        if (err instanceof ThresholdBlockError) {
          thresholds = DEFAULT_THRESHOLDS;
        } else {
          throw err;
        }
      }

      // Plan 2 Wave 3: thread vaultPath/today/claimsConfig into the
      // orchestrator so the new claim-driven extensions populate. The
      // orchestrator returns a Promise when `vaultPath` is set
      // (async overload); `await` coerces correctly either way.
      const proposal = await proposeEvolution({
        profile: {
          id: input.pokemon_id,
          title: String(profile.frontmatter.title ?? input.pokemon_id),
          pokemon_type: String(profile.frontmatter.pokemon_type ?? "normal"),
          evolution_stage: (profile.frontmatter.evolution_stage ?? "basic") as EvolutionStage,
          autonomy_level: String(profile.frontmatter.autonomy_level ?? "restricted"),
          moveset: Array.isArray(profile.frontmatter.moveset) ? profile.frontmatter.moveset : [],
          created: String(profile.frontmatter.created ?? "")
        },
        stats: {
          tasks_completed: stats.tasks_completed,
          tasks_failed: stats.tasks_failed,
          success_rate: stats.success_rate,
          moves_used_freq: stats.moves_used_freq
        },
        memory_page_id: memoryPageId,
        thresholds,
        vaultPath: ctx.vaultPath,
        today: ctx.today ?? new Date(),
        claimsConfig: getClaimsConfig(ctx.rawConfig ?? {})
      });

      // PokeAPI-driven naming (Plan C.1c) — only when a fetcher is explicitly provided
      if (proposal.eligible && proposal.proposed.name === null && ctx.fetcher) {
        try {
          const next = await nextEvolution(ctx.vaultPath, bare, { fetcher: ctx.fetcher });
          if (next) {
            proposal.proposed.name = `profile-${next.name}`;
          }
        } catch {
          // Network failure or invalid Pokemon — keep name: null, fall back to no rename.
        }
      }
      return { ...proposal, caller_trainer_id: trainerCtx?.trainerId };
    }

    // Commit phase — validate required commit fields at runtime
    if (!input.expected_updated) {
      throw new Error("expected_updated is required when commit:true");
    }
    if (!input.proposal) {
      throw new Error("proposal is required when commit:true");
    }

    const profile = readProfileFromWiki(ctx.vaultPath, wiki, input.pokemon_id);
    if (String(profile.frontmatter.updated ?? profile.frontmatter.created ?? "") !== input.expected_updated) {
      throw new Error(`OCC conflict: expected_updated ${input.expected_updated} does not match current ${profile.frontmatter.updated ?? profile.frontmatter.created}`);
    }

    const proposal = input.proposal;
    const oldId = input.pokemon_id;
    let newId = input.pokemon_id;
    let aliasRecorded = false;
    const filesRenamed: string[] = [];

    // 1. Rename if proposal.proposed.name is non-null and differs from current id.
    // Inlined wiki-scoped rename (instead of calling renameProfile from core/profiles.ts
    // which hardcodes wikis/_agents/profiles/ — broken when wiki !== "_agents").
    if (proposal.proposed.name && proposal.proposed.name !== input.pokemon_id) {
      const profilesDir = join(ctx.vaultPath, "wikis", wiki, "profiles");
      const oldPath = join(profilesDir, `${input.pokemon_id}.md`);
      const newPath = join(profilesDir, `${proposal.proposed.name}.md`);

      if (!existsSync(oldPath)) {
        throw new ProfileNotFoundError(input.pokemon_id);
      }
      if (existsSync(newPath)) {
        throw new Error(`profile id ${proposal.proposed.name} already exists at ${newPath}`);
      }

      // Read, update id/wiki/previous_names in frontmatter, write to new path
      const oldRaw = readFileSync(oldPath, "utf8");
      const { frontmatter: oldFm, body: oldBody } = parseFrontmatter(oldRaw);
      const priorPreviousNames: string[] = Array.isArray(oldFm.previous_names)
        ? oldFm.previous_names
        : [];
      const renamedFm: Record<string, any> = {
        ...oldFm,
        id: proposal.proposed.name,
        wiki,
        previous_names: [...priorPreviousNames, input.pokemon_id]
      };
      writeFileSync(newPath, serializeFrontmatter(renamedFm, oldBody));
      unlinkSync(oldPath);
      recordRename(ctx.vaultPath, input.pokemon_id, proposal.proposed.name);

      newId = proposal.proposed.name;
      aliasRecorded = true;
      filesRenamed.push(newPath);
    }

    // 2. Apply frontmatter changes (stage bump, autonomy, moveset additions/removals)
    const targetPath = join(
      ctx.vaultPath, "wikis", wiki, "profiles", `${newId}.md`
    );
    const raw = readFileSync(targetPath, "utf8");
    const { frontmatter, body } = parseFrontmatter(raw);

    const currentMoveset: string[] = Array.isArray(frontmatter.moveset) ? frontmatter.moveset : [];
    const afterRemovals = currentMoveset.filter(m => !proposal.proposed.moveset_removals.includes(m));
    const afterAdditions = [...afterRemovals, ...proposal.proposed.moveset_additions.filter(m => !afterRemovals.includes(m))];

    const newFm: Record<string, any> = {
      ...frontmatter,
      evolution_stage: proposal.proposed.evolution_stage,
      autonomy_level: proposal.proposed.autonomy_level,
      moveset: afterAdditions,
      updated: new Date().toISOString().slice(0, 10)
    };

    writeFileSync(targetPath, serializeFrontmatter(newFm, body));

    // Auto-resync deployed repos (Plan C.1c)
    const filesResynced: { repo: string; skills_dir: string }[] = [];

    // v1.6 §6.3: when renaming, optionally remove the pre-rename per-deployment
    // skills directory. Done BEFORE registry migration + re-deploy so that
    // re-deploy under the new bare name lands in a clean tree. If cleanup
    // throws, the error surfaces here and re-deploy never runs (atomic-ish:
    // no half-cleaned, half-redeployed state on disk). Defaults to true when
    // omitted: integration tests call the handler directly (bypassing the
    // Zod parser that would have applied `.default(true)`), so we resolve
    // the default here as well.
    const cleanupOldSkillsDir = input.cleanup_old_skills_dir ?? true;
    if (oldId !== newId && cleanupOldSkillsDir) {
      const preMigration = readDeployments(ctx.vaultPath);
      const oldEntries = preMigration[oldId] ?? [];
      for (const e of oldEntries) {
        removeOldDeployment(e, oldId);
      }
    }

    if (oldId !== newId) {
      migrateDeploymentKey(ctx.vaultPath, oldId, newId);
    }
    const deployments = readDeployments(ctx.vaultPath);
    const entries = deployments[newId] ?? [];
    for (const e of entries) {
      try {
        const result = syncMoveset({
          vaultPath: ctx.vaultPath,
          repoPath: e.repo_path,
          pokemon_id: newId,
          target: e.target,
          mode: e.mode
        });
        filesResynced.push({ repo: e.repo_path, skills_dir: result.skills_dir });
      } catch {
        // Best-effort resync; surface failures via lint or future sync-skills --reverify (v1.6)
      }
    }

    return {
      old_id: oldId,
      new_id: newId,
      files_renamed: filesRenamed,
      files_resynced: filesResynced,
      alias_recorded: aliasRecorded,
      caller_trainer_id: trainerCtx?.trainerId
    };
  }
};
