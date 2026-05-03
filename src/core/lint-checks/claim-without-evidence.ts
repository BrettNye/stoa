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
// Types are defined locally rather than imported from `../lint-check.js`
// to (a) avoid the name-collision with the existing `LintCheck` interface
// there and (b) keep this task's segregation contract intact (this task's
// `files:` only lists this file). The 5 sibling claim rules will mirror
// these types until the wiring task hoists them to a shared module.

export interface ClaimLintFinding {
  ruleId: string;
  severity: "warn" | "error" | "info";
  line: number;
  message: string;
  filePath?: string;
}

export interface ClaimLintPage {
  frontmatter: Record<string, unknown> | undefined;
  content?: string;
  filePath?: string;
}

export interface ClaimLintCheck {
  id: string;
  severity: "warn" | "error" | "info";
  appliesTo: (page: ClaimLintPage) => boolean;
  check: (page: ClaimLintPage) => ClaimLintFinding[];
}

export const claimWithoutEvidence: ClaimLintCheck = {
  id: "claim-without-evidence",
  severity: "warn",
  appliesTo: (page) => page.frontmatter?.type === "claim",
  check: (page): ClaimLintFinding[] => {
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
