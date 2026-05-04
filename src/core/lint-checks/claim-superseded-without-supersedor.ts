// vault-mcp/src/core/lint-checks/claim-superseded-without-supersedor.ts
//
// Plan 1 §task-lint-superseded-no-supersedor — corpus-integrity guard.
//
// `ClaimSuperseded` (vault-mcp/src/types/claim.ts) requires `superseded_by:
// string` (non-null, non-empty) when `status: "superseded"`. The Zod schema
// enforces it on the write path. This lint catches the bypass case — hand-
// edits or git-merge artifacts that produce a "superseded" claim without a
// supersedor — so corpus integrity is enforced even outside `vault.claim`.
//
// Severity is `error`, not `warn`: a dangling supersession with no target
// breaks the supersession DAG, which downstream consumers (Plan 2 evolve-
// profile, Plan 3 sync-skills) traverse to compute current claims.
//
// Note on type definitions: this file declares `LintCheck` + `LintFinding`
// locally because the foundation `lint-check.ts` registry uses a different
// (registerLintCheck + Diagnostic) shape and the registration adapter task
// (`task-lint-checks-registration`) is what bridges the two. Keeping the
// types co-located here means the rule compiles standalone; the wiring task
// can later promote the types to a shared module.

export interface LintFinding {
  ruleId: string;
  severity: "error" | "warn" | "info";
  line: number;
  message: string;
}

export interface PageLike {
  frontmatter?: Record<string, unknown>;
}

export interface LintCheck {
  id: string;
  severity: "error" | "warn" | "info";
  appliesTo: (page: PageLike) => boolean;
  check: (page: PageLike) => LintFinding[];
}

export const claimSupersededWithoutSupersedor: LintCheck = {
  id: "claim-superseded-without-supersedor",
  severity: "error",
  appliesTo: (page) => page.frontmatter?.type === "claim",
  check: (page): LintFinding[] => {
    const fm = page.frontmatter ?? {};
    if (fm.status !== "superseded") return [];
    // Treat null, undefined, and empty-string as "no supersedor" — all three
    // are bypass states that ClaimSuperseded.parse() would reject.
    if (fm.superseded_by) return [];
    return [
      {
        ruleId: "claim-superseded-without-supersedor",
        severity: "error",
        line: 1,
        message:
          "Claim status is 'superseded' but superseded_by is null. Set superseded_by, or revert status to active.",
      },
    ];
  },
};
