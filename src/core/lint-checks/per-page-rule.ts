// src/core/lint-checks/per-page-rule.ts
//
// Canonical types for the per-page lint rule shape. Three existing rule
// files (claim-without-evidence, claim-with-no-scope,
// claim-superseded-without-supersedor) previously each redeclared these
// locally — see registration.ts:55-58 for context. Consolidating here
// per task-ready-gate spec §6.

export type LintSeverity = "error" | "warn" | "info";

export interface PerPageRuleFinding {
  ruleId: string;
  severity: LintSeverity;
  line: number;
  message: string;
  filePath?: string;
}

export interface PerPageRulePage {
  frontmatter?: Record<string, unknown>;
  content?: string;
  filePath?: string;
}

export interface PerPageRule {
  id: string;
  severity: LintSeverity;
  appliesTo: (page: PerPageRulePage) => boolean;
  check: (page: PerPageRulePage) => PerPageRuleFinding[];
}
