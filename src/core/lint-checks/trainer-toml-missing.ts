import { registerLintCheck } from "../lint-check.js";
import { readStadiumTomlTrainers, readAgentTrainerFiles } from "./trainer-file-missing.js";
import type { Diagnostic } from "../lint.js";

// TRAINER_TOML_MISSING (severity:error). Stadium substrate spec §3.3.
//
// When linting `_agents/`, scans `wikis/_agents/trainers/trainer-<slug>.md`
// files. For each slug derived from the filename, verifies that a matching
// `[trainer.<slug>]` block exists in `~/.vault/stadium.toml`. If absent,
// emits an error-severity diagnostic.
//
// Absence of trainers/ dir → no diagnostics. Only fires when wiki filter is
// `_agents` or absent (all-wikis scan). Does NOT fire for other wikis.
//
// Companion rules: TRAINER_FILE_MISSING (inverse), TRAINER_ID_MISMATCH (drift).
registerLintCheck({
  code: "TRAINER_TOML_MISSING",
  run(ctx, _idx, input): Diagnostic[] {
    // Only fire for _agents wiki
    if (input.wiki && input.wiki !== "_agents") return [];

    const tomlTrainers = readStadiumTomlTrainers();
    const fileTrainers = readAgentTrainerFiles(ctx.vaultPath);
    if (fileTrainers.size === 0) return [];

    const diagnostics: Diagnostic[] = [];

    for (const [slug, { filePath }] of fileTrainers.entries()) {
      if (!tomlTrainers.has(slug)) {
        diagnostics.push({
          severity: "error",
          code: "TRAINER_TOML_MISSING",
          wiki: "_agents",
          message: `trainer-${slug}.md exists but no [trainer.${slug}] block in ~/.vault/stadium.toml`,
          suggestion: `add [trainer.${slug}] with trainer_id and api_key to ~/.vault/stadium.toml, or remove ${filePath}`,
        });
      }
    }

    return diagnostics;
  },
});
