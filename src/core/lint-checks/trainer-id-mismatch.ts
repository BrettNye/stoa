import { registerLintCheck } from "../lint-check.js";
import { readStadiumTomlTrainers, readAgentTrainerFiles } from "./trainer-file-missing.js";
import type { Diagnostic } from "../lint.js";

// TRAINER_ID_MISMATCH (severity:error). Stadium substrate spec §3.3.
//
// When linting `_agents/`, for each slug present in BOTH the toml and the
// trainers directory, compares `trainer_id` values. If they differ, emits an
// error-severity diagnostic.
//
// Only fires when BOTH sides exist. Missing file → TRAINER_FILE_MISSING.
// Missing toml entry → TRAINER_TOML_MISSING. No overlap between rules.
// Only fires when wiki filter is `_agents` or absent. Does NOT fire for other wikis.
registerLintCheck({
  code: "TRAINER_ID_MISMATCH",
  run(ctx, _idx, input): Diagnostic[] {
    // Only fire for _agents wiki
    if (input.wiki && input.wiki !== "_agents") return [];

    const tomlTrainers = readStadiumTomlTrainers();
    if (tomlTrainers.size === 0) return [];

    const fileTrainers = readAgentTrainerFiles(ctx.vaultPath);
    if (fileTrainers.size === 0) return [];

    const diagnostics: Diagnostic[] = [];

    for (const [slug, tomlEntry] of tomlTrainers.entries()) {
      const fileEntry = fileTrainers.get(slug);
      if (!fileEntry) continue; // covered by TRAINER_FILE_MISSING

      if (tomlEntry.trainer_id !== fileEntry.trainer_id) {
        diagnostics.push({
          severity: "error",
          code: "TRAINER_ID_MISMATCH",
          wiki: "_agents",
          message: `trainer ${slug}: toml trainer_id=${tomlEntry.trainer_id ?? "(missing)"} != file frontmatter trainer_id=${fileEntry.trainer_id ?? "(missing)"}`,
          suggestion: `update either ~/.vault/stadium.toml [trainer.${slug}].trainer_id or wikis/_agents/trainers/trainer-${slug}.md frontmatter to match`,
        });
      }
    }

    return diagnostics;
  },
});
