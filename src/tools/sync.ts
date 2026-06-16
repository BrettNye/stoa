// src/tools/sync.ts
//
// Consolidated sync tool (vault_sync) replacing vault_sync-skills and
// vault_sync-agents. Dispatches on `surface: "skills" | "agents"`.
//
// Field normalization (audit fixes C1/H1/H2):
//   repo_path — filesystem path on both surfaces
//     (was: skills.repo_path / agents.target)
//   runtime   — output-format enum (claude-code|openclaw|codex)
//     (was: skills.target / agents.runtime)
//   mode      — no schema default; handler resolves surface default:
//     skills → symlink, agents → copy (H1)
//
// Surface-specific refines are enforced inside the handler, NOT as top-level
// .refine() calls, because the two surfaces have different constraints (H2).

import { z } from "zod";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { syncMoveset, resolveSkillsDir } from "../core/skills.js";
import { readDeployments, type DeploymentEntry } from "../core/deployments.js";
import { detectDriftAt, deployMove, type DriftReport } from "../core/skills-platform.js";
import { readProfile } from "../core/profiles.js";
import { renderClaimSectionInSkillMd } from "../core/claim-render.js";
import { getClaimsConfig } from "../config.js";
import { enumerateProfilesForSync } from "../core/sync-enumerate.js";
import { withSerializedIndexWrite } from "../core/index-locking.js";
import { buildIntent } from "../core/subagent-intent.js";
import { getAdapter } from "../core/runtime-adapters/registry.js";
import { resolveCurrent } from "../core/aliases.js";
import { ProfileNotFoundError } from "../core/profiles.js";
import type { RuntimeName, ValidationDiagnostic } from "../core/runtime-adapters/types.js";
import type { ToolScope } from "../auth/types.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const Input = z.object({
  surface: z.enum(["skills", "agents"]),
  repo_path: z.string(),
  // shared: output-format enum (skills: claude-code|openclaw|codex; agents: claude-code only)
  runtime: z.enum(["claude-code", "openclaw", "codex"]).default("claude-code"),
  // mode has NO top-level default — surface default applied in handler (skills→symlink, agents→copy)
  mode: z.enum(["copy", "symlink"]).optional(),
  pokemon: z.union([z.string(), z.array(z.string())]).optional(),
  all: z.boolean().default(false),
  exclude: z.array(z.string()).default([]),
  pokemon_type: z.array(z.string()).default([]),
  continue_on_error: z.boolean().default(false),
  wiki: z.string().optional(),
  // skills-only fields
  reverify: z.boolean().default(false),
  fix: z.boolean().default(false),
  // agents-only fields
  overwrite: z.boolean().default(true),
  include_moveset: z.boolean().default(true),
});

type SyncInput = z.infer<typeof Input>;

// ---------------------------------------------------------------------------
// Shared context types
// ---------------------------------------------------------------------------

type SkillsCtx = { vaultPath: string; today?: Date; rawConfig?: unknown };
type AgentsCtx = { vaultPath: string };

// ---------------------------------------------------------------------------
// Skills — internal helpers (extracted from vault_sync-skills)
// ---------------------------------------------------------------------------

function bareName(pokemonId: string): string {
  return pokemonId.startsWith("profile-")
    ? pokemonId.slice("profile-".length)
    : pokemonId;
}

async function deployOnePokemonSkills(
  ctx: SkillsCtx,
  input: { repo_path: string; pokemon: string; target: "claude-code" | "openclaw" | "codex"; mode: "copy" | "symlink"; wiki?: string }
): Promise<{ skills_dir: string; moves_synced: string[]; moves_skipped_unsupported: string[] }> {
  const profile = readProfile(ctx.vaultPath, input.pokemon);
  const moveset: string[] = Array.isArray(profile.frontmatter.moveset)
    ? (profile.frontmatter.moveset as string[])
    : [];
  const today = ctx.today ?? new Date();
  const claimsConfig = getClaimsConfig(ctx.rawConfig ?? {});
  for (const moveId of moveset) {
    const skillMdPath = join(ctx.vaultPath, "wikis", "_agents", "moves", moveId, "SKILL.md");
    try {
      await renderClaimSectionInSkillMd({
        skillMdPath,
        moveId,
        deployingProfileId: input.pokemon,
        vaultPath: ctx.vaultPath,
        today,
        config: claimsConfig,
      });
    } catch {
      // SKILL.md missing or unreadable — skip silently.
    }
  }
  const result = syncMoveset({
    vaultPath: ctx.vaultPath,
    repoPath: input.repo_path,
    pokemon_id: input.pokemon,
    target: input.target,
    mode: input.mode,
    wiki: input.wiki,
  });
  return {
    skills_dir: result.skills_dir,
    moves_synced: result.moves_synced,
    moves_skipped_unsupported: result.moves_skipped_unsupported,
  };
}

export interface ReverifyResult {
  drift: DriftReport[];
  drift_fixed: number;
}

function runReverify(
  input: { repo_path: string; pokemon?: string | string[]; target: "claude-code" | "openclaw" | "codex"; fix: boolean },
  ctx: { vaultPath: string }
): ReverifyResult {
  const registry = readDeployments(ctx.vaultPath);
  const aggregatedDrift: DriftReport[] = [];
  const driftContext: { pokemonId: string; entry: DeploymentEntry }[] = [];

  for (const pokemonId of Object.keys(registry)) {
    // pokemon filter: only string (array is an agents-surface feature)
    const pokemonFilter = typeof input.pokemon === "string" ? input.pokemon : undefined;
    if (pokemonFilter && pokemonId !== pokemonFilter) continue;

    const entries = registry[pokemonId] ?? [];
    for (const entry of entries) {
      if (entry.repo_path !== input.repo_path) continue;
      if (entry.target !== input.target) continue;

      const skillsDir = resolveSkillsDir(entry.repo_path, entry.target, bareName(pokemonId));
      let moves: string[];
      try {
        const profile = readProfile(ctx.vaultPath, pokemonId);
        moves = Array.isArray(profile.frontmatter.moveset) ? profile.frontmatter.moveset : [];
      } catch {
        continue;
      }

      const reports = detectDriftAt({ skills_dir: skillsDir, moves }, ctx.vaultPath);
      for (const r of reports) {
        aggregatedDrift.push(r);
        driftContext.push({ pokemonId, entry });
      }
    }
  }

  let driftFixed = 0;
  if (input.fix) {
    for (let i = 0; i < aggregatedDrift.length; i++) {
      const drift = aggregatedDrift[i];
      const { entry } = driftContext[i];
      const moveSrcDir = join(ctx.vaultPath, "wikis", "_agents", "moves", drift.move_id);
      const destDir = drift.deployment_path.replace(/[\\/]SKILL\.md$/, "");
      if (existsSync(destDir)) {
        rmSync(destDir, { recursive: true, force: true });
      }
      mkdirSync(destDir.replace(/[\\/][^\\/]+$/, ""), { recursive: true });
      const requested = entry.actual_mode ?? entry.mode;
      deployMove(moveSrcDir, destDir, requested);
      driftFixed += 1;
    }
  }

  return { drift: aggregatedDrift, drift_fixed: driftFixed };
}

async function runSyncSkills(
  input: SyncInput & { mode: "copy" | "symlink"; target: "claude-code" | "openclaw" | "codex" },
  ctx: SkillsCtx
): Promise<any> {
  if (input.fix && !input.reverify) {
    throw new Error("`fix: true` requires `reverify: true` (the fix path operates on the drift report produced by reverify).");
  }

  if (input.reverify) {
    return runReverify(
      { repo_path: input.repo_path, pokemon: typeof input.pokemon === "string" ? input.pokemon : undefined, target: input.target, fix: input.fix },
      ctx
    );
  }

  if (input.all) {
    const list = enumerateProfilesForSync(ctx.vaultPath, {
      exclude: input.exclude ?? [],
      pokemon_type: input.pokemon_type ?? [],
    });
    const results: Array<{
      pokemon: string;
      skills_dir?: string;
      moves_synced?: string[];
      moves_skipped_unsupported?: string[];
      status: "deployed" | "failed";
      error?: string;
    }> = [];

    for (const pokemonId of list) {
      try {
        const sub = await deployOnePokemonSkills(
          { vaultPath: ctx.vaultPath, today: ctx.today, rawConfig: ctx.rawConfig },
          { repo_path: input.repo_path, pokemon: pokemonId, target: input.target, mode: input.mode, wiki: input.wiki }
        );
        results.push({
          pokemon: pokemonId,
          skills_dir: sub.skills_dir,
          moves_synced: sub.moves_synced,
          moves_skipped_unsupported: sub.moves_skipped_unsupported,
          status: "deployed",
        });
      } catch (e: any) {
        results.push({ pokemon: pokemonId, status: "failed", error: e?.message ?? String(e) });
        if (!input.continue_on_error) break;
      }
    }

    return {
      results,
      summary: {
        requested: list.length,
        deployed: results.filter(r => r.status === "deployed").length,
        skipped: 0,
        failed: results.filter(r => r.status === "failed").length,
      },
    };
  }

  if (!input.pokemon) {
    throw new Error("`pokemon` is required when deploying without `all: true`");
  }

  const pokemonStr = Array.isArray(input.pokemon) ? input.pokemon[0] : input.pokemon;
  return deployOnePokemonSkills(ctx, {
    repo_path: input.repo_path,
    pokemon: pokemonStr,
    target: input.target,
    mode: input.mode,
    wiki: input.wiki,
  });
}

// ---------------------------------------------------------------------------
// Agents — internal helpers (extracted from vault_sync-agents)
// ---------------------------------------------------------------------------

export interface PerPokemonResult {
  pokemon: string;
  deployed: Record<string, string>;
  registry_entry: { runtime: RuntimeName; source_revision: string; subagent_def_path: string };
  moveset_synced: boolean;
  status: "deployed" | "skipped-no-change" | "failed";
  warnings?: ValidationDiagnostic[];
  error?: string;
}

export interface AgentsResultShape {
  results: PerPokemonResult[];
  summary: { requested: number; deployed: number; skipped: number; failed: number };
}

function normalizeProfileId(vaultPath: string, raw: string): string {
  const r1 = resolveCurrent(vaultPath, raw);
  if (r1 !== raw) return r1;
  const candidate = raw.startsWith("profile-") ? raw : `profile-${raw}`;
  return resolveCurrent(vaultPath, candidate);
}

async function deploySingleAgent(
  vaultPath: string,
  rawPokemon: string,
  target: string,
  runtime: RuntimeName,
  mode: "copy" | "symlink",
  overwrite: boolean,
  includeMoveset: boolean
): Promise<PerPokemonResult> {
  const profileId = normalizeProfileId(vaultPath, rawPokemon);

  let intent;
  try {
    intent = buildIntent(vaultPath, profileId);
  } catch (e: any) {
    if (e instanceof ProfileNotFoundError) {
      return {
        pokemon: rawPokemon, deployed: {}, registry_entry: {} as any,
        moveset_synced: false, status: "failed",
        error: `profile not found: ${rawPokemon}`,
      };
    }
    throw e;
  }

  const adapter = getAdapter(runtime);

  return withSerializedIndexWrite(vaultPath, ["deployments.json"], async (): Promise<PerPokemonResult> => {
    const validation = await adapter.validate(intent, target);
    if (!validation.ok) {
      return {
        pokemon: profileId, deployed: {}, registry_entry: {} as any,
        moveset_synced: false, status: "failed",
        error: `validate failed: ${validation.errors.map(e => e.message).join("; ")}`,
        warnings: validation.warnings,
      };
    }

    const deployResult = await adapter.deploy(intent, target, {
      mode, overwrite, registry_path: vaultPath,
    });

    let movesetSynced = false;
    if (includeMoveset && deployResult.status === "deployed") {
      try {
        syncMoveset({
          vaultPath, repoPath: target, pokemon_id: profileId,
          target: "claude-code", mode,
        });
        movesetSynced = true;
      } catch (e: any) {
        return {
          pokemon: profileId, deployed: {}, registry_entry: {} as any,
          moveset_synced: false, status: "failed",
          error: `syncMoveset failed: ${e.message}`,
          warnings: validation.warnings,
        };
      }
    }

    const verify = await adapter.verify(intent, target);
    if (!verify.ok) {
      return {
        pokemon: profileId, deployed: {}, registry_entry: {} as any,
        moveset_synced: movesetSynced, status: "failed",
        error: `verify failed: ${verify.violations.map(v => v.message).join("; ")}`,
        warnings: validation.warnings,
      };
    }

    return {
      pokemon: profileId,
      deployed: { agent_def: deployResult.files_written[0] },
      registry_entry: {
        runtime,
        source_revision: deployResult.source_revision,
        subagent_def_path: deployResult.files_written[0],
      },
      moveset_synced: movesetSynced,
      status: deployResult.status,
      warnings: validation.warnings,
    };
  });
}

async function runSyncAgents(
  input: SyncInput & { mode: "copy" | "symlink" },
  ctx: AgentsCtx
): Promise<AgentsResultShape> {
  // H2: agents refines
  const pokemonDefined = input.pokemon !== undefined;
  if (pokemonDefined && input.all) {
    throw new Error("`pokemon` and `all` are mutually exclusive");
  }
  if (!input.all && !pokemonDefined) {
    throw new Error("one of `pokemon` or `all: true` is required");
  }
  if (!input.all && ((input.exclude?.length ?? 0) > 0 || (input.pokemon_type?.length ?? 0) > 0)) {
    throw new Error("`exclude` and `pokemon_type` are only valid with `all: true`");
  }

  const list: string[] = input.all === true
    ? enumerateProfilesForSync(ctx.vaultPath, {
        exclude: input.exclude ?? [],
        pokemon_type: input.pokemon_type ?? [],
      })
    : Array.isArray(input.pokemon)
      ? input.pokemon
      : [input.pokemon as string];

  const continueOnError = input.continue_on_error === true;
  const results: PerPokemonResult[] = [];

  for (const p of list) {
    const r = await deploySingleAgent(
      ctx.vaultPath, p, input.repo_path, input.runtime as RuntimeName,
      input.mode, input.overwrite, input.include_moveset
    );
    results.push(r);
    if (r.status === "failed" && !continueOnError) break;
  }

  const summary = {
    requested: list.length,
    deployed: results.filter(r => r.status === "deployed").length,
    skipped: results.filter(r => r.status === "skipped-no-change").length,
    failed: results.filter(r => r.status === "failed").length,
  };
  return { results, summary };
}

// ---------------------------------------------------------------------------
// Tool export
// ---------------------------------------------------------------------------

const scope: ToolScope = {
  axis: () => "*",
  httpForbidden: true,
};

export const syncTool = {
  name: "vault_sync",
  description:
    "Deploy a Pokemon's artifacts to a repo. surface: skills (moveset → local skills dir; reverify/fix drift) | agents (subagent defs via runtime adapter). repo_path = target dir; runtime = output format; `mode` stays copy|symlink.",
  inputSchema: Input,
  scope,
  handler: async (
    input: SyncInput,
    ctx: { vaultPath: string; today?: Date; rawConfig?: unknown }
  ) => {
    // H1: surface-dependent mode default (no schema default)
    const mode = input.mode ?? (input.surface === "skills" ? "symlink" : "copy");

    if (input.surface === "skills") {
      // H2: skills refines — enforced here in the handler
      const pokemonDefined = input.pokemon !== undefined;
      if (pokemonDefined && input.all) {
        throw new Error("`pokemon` and `all` are mutually exclusive");
      }
      if (!input.reverify && !pokemonDefined && !input.all) {
        throw new Error("deploy mode (reverify=false) requires `pokemon` or `all: true`");
      }
      // Map normalized names back to skills internal contract:
      //   skills.target = format enum (was skills.target, now input.runtime)
      return runSyncSkills(
        { ...input, mode, target: input.runtime as "claude-code" | "openclaw" | "codex" },
        ctx
      );
    }

    // surface === "agents"
    // C1: agents only supports claude-code today
    if (input.runtime !== "claude-code") {
      throw new Error(`vault_sync surface=agents supports runtime 'claude-code' only`);
    }

    // runSyncAgents handles H2 refines internally
    return runSyncAgents({ ...input, mode }, ctx);
  },
};
