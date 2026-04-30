import { registerLintCheck } from "../lint-check.js";

// Stub for the AGENT_ATTRIBUTION_DRIFT diagnostic (severity:warning). Wave 3
// (Plan A Task 3-4e) replaces this body with the real implementation that
// validates author: agent:<id> attribution against the alias index, catching
// pages that still reference an aliased-old id past the grace window.
registerLintCheck({
  code: "AGENT_ATTRIBUTION_DRIFT",
  run(_ctx, _idx, _input) {
    // Wave 3 fills body; for now, register the slot and return empty.
    return [];
  },
});
