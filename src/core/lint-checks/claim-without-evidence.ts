// vault-mcp/src/core/lint-checks/claim-without-evidence.ts
//
// Claims Plan 1, foundation DAG — task-lint-no-evidence.
//
// Warns when an active claim has empty `evidence:`. Per the §6.1 evidence
// contract, every active claim should cite at least one wikilink to a
// journal/source/task; otherwise the claim is unaudited assertion.
//
// Shape note: this rule (and its 5 plan-sibling rules under
// vault-mcp/src/core/lint-checks/claim-*.ts) follows a NEW per-page lint
// shape — `{id, severity, appliesTo, check}` returning `LintFinding[]` —
// distinct from the legacy `{code, run(ctx, idx, input)}` registry shape
// in core/lint-check.ts. The two shapes coexist deliberately:
// per-page claim rules are simpler to test in isolation against
// `makePage(...)` stubs (no index/disk plumbing), while the registry
// shape needs the full lint context. The downstream wiring task
// (`task-lint-checks-registration`) bridges these per-page rules into the
// existing registry.
//
// Local interface declarations have been removed in favour of the
// canonical types in `./per-page-rule.ts` (task-type-hoist).

import type { PerPageRule, PerPageRuleFinding } from "./per-page-rule.js";

export const claimWithoutEvidence: PerPageRule = {
  id: "claim-without-evidence",
  severity: "warn",
  appliesTo: (page) => page.frontmatter?.type === "claim",
  check: (page): PerPageRuleFinding[] => {
    const fm = page.frontmatter ?? {};
    if (fm.status !== "active") return [];
    const evidence = (fm.evidence as unknown[] | undefined) ?? [];
    if (evidence.length > 0) return [];
    return [
      {
        ruleId: "claim-without-evidence",
        severity: "warn",
        line: 1,
        message:
          "Active claim has no evidence; add at least one wikilink to a journal/source/task.",
      },
    ];
  },
};
