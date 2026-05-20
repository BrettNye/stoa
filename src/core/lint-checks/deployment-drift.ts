import { registerLintCheck } from "../lint-check.js";
import { readDeployments } from "../deployments.js";
import { detectDriftAt } from "../skills-platform.js";
import { resolveSkillsDir } from "../skills.js";
import { readProfile } from "../profiles.js";

// DEPLOYMENT_DRIFT (severity:info). Spec §6.3.
//
// Walks `_index/deployments.json`. For each entry, derives the on-disk
// `skills_dir` from (`repo_path`, `target`, bare-name) and reads the profile's
// moveset, then calls `detectDriftAt` (T1-2) to hash both ends. Each
// `DriftReport` becomes one info-severity Diagnostic that includes the
// `deployment_path`, `move_id`, and `kind` so an operator can act without
// running `vault_sync-skills --reverify` explicitly.
//
// Failure modes (intentionally narrow surface):
//   - Profile missing but registry entry lingers → swallow + skip the entry.
//     That's a different signal (operator-side cleanup); v1.6 Phase 1 keeps
//     this check focused on bytes-on-disk drift only.
//   - Canonical SKILL.md missing in vault → `detectDriftAt` throws. We swallow
//     per-deployment so one bad move id doesn't poison the whole lint run.

function bareName(pokemonId: string): string {
  return pokemonId.startsWith("profile-")
    ? pokemonId.slice("profile-".length)
    : pokemonId;
}

registerLintCheck({
  code: "DEPLOYMENT_DRIFT",
  run(ctx, _idx, _input) {
    const registry = readDeployments(ctx.vaultPath);
    const diagnostics = [];

    for (const pokemonId of Object.keys(registry)) {
      const entries = registry[pokemonId] ?? [];
      for (const entry of entries) {
        // Profile-side enumeration: bail early if the profile is gone.
        // readProfile is alias-aware (T2-1), so a renamed profile still resolves.
        let moves: string[];
        try {
          const profile = readProfile(ctx.vaultPath, pokemonId);
          moves = Array.isArray(profile.frontmatter.moveset)
            ? profile.frontmatter.moveset
            : [];
        } catch {
          // Orphan registry entry (operator-side cleanup signal, not drift).
          continue;
        }

        const skillsDir = resolveSkillsDir(entry.repo_path, entry.target, bareName(pokemonId));

        let reports;
        try {
          reports = detectDriftAt({ skills_dir: skillsDir, moves }, ctx.vaultPath);
        } catch {
          // Canonical SKILL.md missing or other vault-integrity problem.
          // Different lint signal; skip rather than crash the whole run.
          continue;
        }

        for (const r of reports) {
          diagnostics.push({
            severity: "info" as const,
            code: "DEPLOYMENT_DRIFT",
            page_id: pokemonId,
            wiki: "_agents",
            message: `deployment drift (${r.kind}) for move "${r.move_id}" at ${r.deployment_path}`,
            suggestion: "run `vault_sync-skills --reverify --fix` against this deployment to re-deploy drifted moves"
          });
        }
      }
    }

    return diagnostics;
  },
});
