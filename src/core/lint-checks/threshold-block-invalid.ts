import { registerLintCheck } from "../lint-check.js";
import { readThresholds, ThresholdBlockError } from "../thresholds.js";

// THRESHOLD_BLOCK_INVALID (severity:error). v1.6 §6.3 + §7.3.
//
// At lint time, attempt to parse `wikis/_agents/CLAUDE.md`'s
// `yaml evolution_thresholds` fenced block via core/thresholds.readThresholds.
// On ThresholdBlockError, surface a single diagnostic carrying the parser's
// message so the operator knows what to fix.
//
// Severity is `error` even though `evolve-profile` (T3-1) absorbs the failure
// and runs with defaults. Lint surfaces it loudly so a broken block doesn't
// silently mask intended thresholds.
//
// Absence (no fence, no file, valid block) → no diagnostic.
registerLintCheck({
  code: "THRESHOLD_BLOCK_INVALID",
  run(ctx, _idx, _input) {
    try {
      readThresholds(ctx.vaultPath);
      return [];
    } catch (e) {
      if (e instanceof ThresholdBlockError) {
        return [{
          severity: "error" as const,
          code: "THRESHOLD_BLOCK_INVALID",
          wiki: "_agents",
          message: e.message,
          suggestion: "fix the 'yaml evolution_thresholds' block in wikis/_agents/CLAUDE.md (or remove it to fall back to defaults: basic_to_stage1=30/0.80, stage1_to_stage2=100/0.85)",
        }];
      }
      throw e;
    }
  },
});
