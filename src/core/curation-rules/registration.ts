// vault-mcp/src/core/curation-rules/registration.ts
//
// Plan vault_curate §task-rules-barrel — wiring task.
//
// Side-effect barrel: a single import of this module registers all four
// curation rules into `curationRuleRegistry` (defined in `../curation-rule.ts`).
//
// Each rule file calls `registerCurationRule(...)` as a top-level side effect
// on first import; Node's module cache makes re-import a no-op.
//
// Import order matches the plan §task-rules-barrel `depends_on:` list.

import "./promote-landed.js";
import "./promote-active.js";
import "./archive-stale.js";
import "./resolve-supersede.js";
