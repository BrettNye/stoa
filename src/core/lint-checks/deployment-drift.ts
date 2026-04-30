import { registerLintCheck } from "../lint-check.js";

// Stub for the DEPLOYMENT_DRIFT diagnostic (severity:info). Wave 3
// (Plan A Task 3-4d) replaces this body with the real implementation that
// uses core/skills-platform.ts (Task 1-2) to detect drift between deployed
// skills and their canonical move source.
registerLintCheck({
  code: "DEPLOYMENT_DRIFT",
  run(_ctx, _idx, _input) {
    // Wave 3 fills body; for now, register the slot and return empty.
    return [];
  },
});
