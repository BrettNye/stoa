import { registerLintCheck } from "../lint-check.js";

// Stub for the CROSS_WIKI_LINK_BROKEN diagnostic (severity:error). Wave 3
// (Plan A Task 3-4a) replaces this body with the real implementation that
// uses the wikilinks extractor (Task 1-3) to detect [[wikis/<other>/...]]
// references whose target page is missing from the index.
registerLintCheck({
  code: "CROSS_WIKI_LINK_BROKEN",
  run(_ctx, _idx, _input) {
    // Wave 3 fills body; for now, register the slot and return empty.
    return [];
  },
});
