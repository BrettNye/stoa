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
import type { ToolScope } from "../auth/types.js";

const Input = z.object({
  repo_path: z.string(),
  // `pokemon` is optional only when `reverify=true` (a reverify scan can span
  // every deployment matching `repo_path` + `target`) OR when `all: true` is
  // set (Task 5 / sync-all-flag plan). For the default deploy path, the
  // handler enforces that `pokemon` is set.
  pokemon: z.string().optional(),
  // sync-all-flag plan (Task 5). When true, deploy every profile matching
  // `pokemon_type` and not in `exclude`. Mutually exclusive with `pokemon:`.
  // Coexists with the pre-existing `reverify` implicit-all path — refines
  // (not a discriminated union) so that path keeps working.
  all: z.boolean().default(false),
  exclude: z.array(z.string()).default([]),
  pokemon_type: z.array(z.string()).default([]),
  target: z.enum(["claude-code", "openclaw", "codex"]).default("claude-code"),
  mode: z.enum(["copy", "symlink"]).default("symlink"),
  // T10 (spec §4.3): wiki context for deployment layering. When set, the
  // underlying syncMoveset additionally walks `wikis/<wiki>/moves/` and
  // layers wiki-local moves on top of the portable moveset. Optional for
  // back-compat with existing callers that key purely off `pokemon`.
  wiki: z.string().optional(),
  // T3-2 (v1.6 §6.2). When true, the tool no-ops the deploy and instead scans
  // the existing deployment registry, hashing each deployed SKILL.md against
  // its canonical vault source to detect drift. With `fix: true`, drifted
  // moves are re-deployed atomically per move.
  reverify: z.boolean().default(false),
  fix: z.boolean().default(false),
  continue_on_error: z.boolean().default(false),
}).refine(
  (v) => !(v.pokemon && v.all),
  { message: "`pokemon` and `all` are mutually exclusive" }
).refine(
  (v) => v.reverify || v.pokemon || v.all,
  { message: "deploy mode (reverify=false) requires `pokemon` or `all: true`" }
);

function bareName(pokemonId: string): string {
  return pokemonId.startsWith("profile-")
    ? pokemonId.slice("profile-".length)
    : pokemonId;
}

const syncSkillsScope: ToolScope = {
  axis: () => "*",
  httpForbidden: true,
};

export const syncSkillsTool = {
  name: "vault_sync-skills",
  description: "Deploy a Pokemon's moveset into a target repo's local skills directory. With reverify=true, scans existing deployments for drift instead of deploying.",
  inputSchema: Input,
  scope: syncSkillsScope,
  handler: async (
    input: z.infer<typeof Input>,
    ctx: {
      vaultPath: string;
      // Claims Plan 3 Wave 2 — clock injection + raw vault config pass-through.
      // Mirrors the pattern landed in evolve-profile (Plan 2). Both optional
      // so DispatchCtx (which carries an optional rawConfig and no today)
      // is structurally assignable. `today` defaults to `new Date()` when
      // omitted; tests should always inject for deterministic outputs.
      today?: Date;
      rawConfig?: unknown;
    }
  ) => {
    if (input.fix && !input.reverify) {
      throw new Error("`fix: true` requires `reverify: true` (the fix path operates on the drift report produced by reverify).");
    }

    if (input.reverify) {
      // Reverify path is unchanged — no claim rendering occurs here. The §8.2
      // pre-render is a deploy-time concern; reverify only hashes existing
      // deployed files against their canonical vault sources.
      return runReverify(input, ctx);
    }

    if (input.all) {
      // Multi-profile deploy path (sync-all-flag plan, Task 6). Enumerate
      // profiles via the shared helper (handles exclude + pokemon_type
      // filters, alias resolution, sorted output) then dispatch to the same
      // single-pokemon helper used by the default path. Returns a
      // {results, summary} envelope distinct from the single-pokemon flat
      // shape — back-compat for callers using `pokemon:` is preserved below.
      const list = enumerateProfilesForSync(ctx.vaultPath, {
        exclude: input.exclude,
        pokemon_type: input.pokemon_type,
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

    return deployOnePokemonSkills(ctx, {
      repo_path: input.repo_path,
      pokemon: input.pokemon,
      target: input.target,
      mode: input.mode,
      wiki: input.wiki,
    });
  }
};

/**
 * Single-profile deploy: §8.2 pre-render loop + syncMoveset call. Extracted
 * from the handler so the `all: true` dispatch can re-use it per profile.
 * Returns the flat shape the handler has historically returned for
 * single-pokemon calls — preserving back-compat for callers and tests that
 * destructure `{skills_dir, moves_synced, moves_skipped_unsupported}`.
 */
async function deployOnePokemonSkills(
  ctx: { vaultPath: string; today?: Date; rawConfig?: unknown },
  input: { repo_path: string; pokemon: string; target: "claude-code" | "openclaw" | "codex"; mode: "copy" | "symlink"; wiki?: string }
): Promise<{ skills_dir: string; moves_synced: string[]; moves_skipped_unsupported: string[] }> {
  // §8.2 pre-render — for each move in the deploying profile's moveset,
  // render the vault-claims:start..end block into the vault SKILL.md so the
  // subsequent `syncMoveset` deploys the freshly-rendered file. A move
  // whose vault SKILL.md does NOT exist is silently skipped — sync-skills
  // must not throw on missing per-move SKILL.md (a profile may declare a
  // move whose source page hasn't landed yet).
  const profile = readProfile(ctx.vaultPath, input.pokemon);
  const moveset: string[] = Array.isArray(profile.frontmatter.moveset)
    ? (profile.frontmatter.moveset as string[])
    : [];
  const today = ctx.today ?? new Date();
  const claimsConfig = getClaimsConfig(ctx.rawConfig ?? {});
  // Note: this overwrites the vault SKILL.md per-call. Under `all: true`, profiles
  // sharing a move see the vault file rewritten each iteration — each deployed
  // copy carries its own caller's claim block, but the vault SKILL.md ends up
  // with the LAST profile's block. Callers reading vault-side SKILL.md after a
  // multi-profile sync should not assume stability across the loop.
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
      // SKILL.md missing or unreadable — skip silently. The downstream
      // syncMoveset will surface a more actionable error if the move
      // source dir is genuinely required but absent.
    }
  }

  const result = syncMoveset({
    vaultPath: ctx.vaultPath,
    repoPath: input.repo_path,
    pokemon_id: input.pokemon,
    target: input.target,
    mode: input.mode,
    // T10 (spec §4.3): pass the wiki so wiki-local moves at
    // wikis/<wiki>/moves/ are layered on top of the portable moveset.
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
  input: z.infer<typeof Input>,
  ctx: { vaultPath: string }
): ReverifyResult {
  const registry = readDeployments(ctx.vaultPath);
  const aggregatedDrift: DriftReport[] = [];
  // For per-move re-deploys: parallel array tracking the originating
  // pokemon id (registry key) + entry, so `--fix` re-deploys correctly
  // even when drift entries span multiple deployments.
  const driftContext: { pokemonId: string; entry: DeploymentEntry }[] = [];

  for (const pokemonId of Object.keys(registry)) {
    if (input.pokemon && pokemonId !== input.pokemon) continue;

    const entries = registry[pokemonId] ?? [];
    for (const entry of entries) {
      if (entry.repo_path !== input.repo_path) continue;
      if (entry.target !== input.target) continue;

      const skillsDir = resolveSkillsDir(entry.repo_path, entry.target, bareName(pokemonId));

      // Enumerate moves from the profile's current moveset. readProfile is
      // alias-aware (T2-1), so a renamed profile still resolves.
      let moves: string[];
      try {
        const profile = readProfile(ctx.vaultPath, pokemonId);
        moves = Array.isArray(profile.frontmatter.moveset) ? profile.frontmatter.moveset : [];
      } catch {
        // Profile gone but a deployment lingers: treat as no-moves-to-check.
        // (A future evolve-profile cleanup should remove the registry entry,
        // but reverify must not crash on a partial state.)
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
      // Re-derive the dest directory from the drift report's deployment_path
      // by stripping the trailing `/SKILL.md`. This keeps fix coupled to the
      // exact path detectDriftAt checked, with no second derivation drift risk.
      const destDir = drift.deployment_path.replace(/[\\/]SKILL\.md$/, "");

      // Per-move atomic re-deploy: clear existing dest (including stale
      // partial dirs / symlink/junction targets) before deployMove writes.
      // Mirrors the pattern in syncMoveset (core/skills.ts ~line 76).
      if (existsSync(destDir)) {
        rmSync(destDir, { recursive: true, force: true });
      }
      // The deployment's parent (skills_dir) was created at first sync;
      // ensure it's still there in case an operator wiped it.
      mkdirSync(destDir.replace(/[\\/][^\\/]+$/, ""), { recursive: true });

      // Use the actual_mode the original deploy landed at when available
      // (v1.6 §3.1), falling back to the requested mode for v1.5 entries.
      const requested = entry.actual_mode ?? entry.mode;
      deployMove(moveSrcDir, destDir, requested);
      driftFixed += 1;
    }
  }

  return { drift: aggregatedDrift, drift_fixed: driftFixed };
}
