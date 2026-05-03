// vault-mcp/src/core/lint-checks/claim-with-no-scope.ts
//
// Plan 1 §task-lint-no-scope — `claim-with-no-scope` rule.
//
// Warns when an active claim has all four scope dimensions empty
// (profile, move, scope_wiki, tags). Such a claim has no read path that
// will surface it: `vault.list-claims --profile=…` / `--move=…` /
// `--scope-wiki=…` / `--tag=…` all miss it, and the global bucket is
// only populated when at least *something* is set elsewhere on the
// claim (see helpers.ts:mkTempVaultWithSidecar — global is keyed off
// "no profile/move/scope_wiki" but the registry treats fully-bare
// claims as orphaned). Tags count as scope per Plan 1 §6.4 — a single
// `tags: ["foo"]` is enough to suppress this warning.
//
// Shape note: this rule follows the plan-1 LintCheck contract
// (`{ id, severity, appliesTo, check }`) which differs from the
// existing core/lint-check.ts registry shape (`{ code, run }`). The
// reconciliation happens in the wiring task (task-lint-checks-
// registration); this file is a leaf in the DAG and ships only the
// rule itself.

export type LintSeverity = "error" | "warn" | "info";

export interface LintFinding {
  ruleId: string;
  severity: LintSeverity;
  line: number;
  message: string;
}

export interface LintCheckPage {
  frontmatter?: Record<string, unknown>;
  content?: string;
  filePath?: string;
}

export interface LintCheck {
  id: string;
  severity: LintSeverity;
  appliesTo: (page: LintCheckPage) => boolean;
  check: (page: LintCheckPage) => LintFinding[];
}

function arrLen(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

export const claimWithNoScope: LintCheck = {
  id: "claim-with-no-scope",
  severity: "warn",
  appliesTo: (page) =>
    page.frontmatter?.type === "claim" && page.frontmatter?.status === "active",
  check: (page): LintFinding[] => {
    const fm = page.frontmatter ?? {};
    const allEmpty =
      arrLen(fm.profile) === 0 &&
      arrLen(fm.move) === 0 &&
      arrLen(fm.scope_wiki) === 0 &&
      arrLen(fm.tags) === 0;
    if (!allEmpty) return [];
    return [{
      ruleId: "claim-with-no-scope",
      severity: "warn",
      line: 1,
      message:
        "Claim has no scope (profile/move/scope_wiki/tags all empty); no read path will surface it.",
    }];
  },
};
