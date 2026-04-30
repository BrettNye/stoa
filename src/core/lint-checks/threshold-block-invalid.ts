import { registerLintCheck } from "../lint-check.js";

// Stub for the THRESHOLD_BLOCK_INVALID diagnostic (severity:error). Wave 3
// (Plan A Task 3-4b) replaces this body with the real implementation that
// uses core/thresholds.ts (Task 1-1) to validate evolution_thresholds fenced
// YAML blocks on profile pages.
registerLintCheck({
  code: "THRESHOLD_BLOCK_INVALID",
  run(_ctx, _idx, _input) {
    // Wave 3 fills body; for now, register the slot and return empty.
    return [];
  },
});
