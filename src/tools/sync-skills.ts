import { z } from "zod";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { syncMoveset, resolveSkillsDir } from "../core/skills.js";
import { readDeployments, type DeploymentEntry } from "../core/deployments.js";
import { detectDriftAt, deployMove, type DriftReport } from "../core/skills-platform.js";
import { readProfile } from "../core/profiles.js";
import { renderClaimSectionInSkillMd } from "../core/claim-render.js";
import { getClaimsConfig } from "../config.js";

const Input = z.object({
  repo_path: z.string(),
  // `pokemon` is optional only when `reverify=true` (a reverify scan can span
  // every deployment matching `repo_path` + `target`). For the default deploy
  // path, the handler enforces that `pokemon` is set.
  pokemon: z.string().optional(),
  target: z.enum(["claude-code", "openclaw", "codex"]).default("claude-code"),
  mode: z.enum(["copy", "symlink"]).default("symlink"),
  // T3-2 (v1.6 §6.2). When true, the tool no-ops the deploy and instead scans
  // the existing deployment registry, hashing each deployed SKILL.md against
  // its canonical vault source to detect drift. With `fix: true`, drifted
  // moves are re-deployed atomically per move.
  reverify: z.boolean().default(false),
  fix: z.boolean().default(false)
});

function bareName(pokemonId: string): string {
  return pokemonId.startsWith("profile-")
    ? pokemonId.slice("profile-".length)
    : pokemonId;
}

export const syncSkillsTool = {
  name: "vault.sync-skills",
  description: "Deploy a Pokemon's moveset into a target repo's local skills directory. With reverify=true, scans existing deployments for drift instead of deploying.",
  inputSchema: Input,
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

    if (!input.pokemon) {
      throw new Error("`pokemon` is required when `reverify=false` (the default deploy path needs a profile to deploy).");
    }

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
      mode: input.mode
    });
    return {
      skills_dir: result.skills_dir,
      moves_synced: result.moves_synced,
      moves_skipped_unsupported: result.moves_skipped_unsupported
    };
  }
};

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
