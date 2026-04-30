import { registerLintCheck } from "../lint-check.js";

// Stub for the ACTIVE_WIKI_DIVERGENCE diagnostic (severity:info). Wave 3
// (Plan A Task 3-4c) replaces this body with the real implementation that
// flags when ctx.defaultWiki diverges from .active-wiki at the vault root.
registerLintCheck({
  code: "ACTIVE_WIKI_DIVERGENCE",
  run(_ctx, _idx, _input) {
    // Wave 3 fills body; for now, register the slot and return empty.
    return [];
  },
});
