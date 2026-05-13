// src/core/lint-checks/task-not-ready.ts
//
// Spec: wikis/_meta/specs/2026-05-13-task-ready-gate-design.md §6.
// Walks pending task pages; emits one warning per task that fails the
// readiness check. Reuses the canonical PerPageRule shape and reuses the
// checker function so the gate and the lint rule never drift.

import type { PerPageRule, PerPageRuleFinding } from "./per-page-rule.js";
import { checkTaskReadiness } from "../task-readiness.js";

export const taskNotReady: PerPageRule = {
  id: "task-not-ready",
  severity: "warn",
  appliesTo: (page) =>
    page.frontmatter?.type === "task" && page.frontmatter?.status === "pending",
  check: (page): PerPageRuleFinding[] => {
    const body = page.content ?? "";
    const readiness = checkTaskReadiness(body);
    if (readiness.ready) return [];
    return [{
      ruleId: "task-not-ready",
      severity: "warn",
      line: 1,
      message: `pending task missing: ${readiness.missing.join(", ")} — claim will be blocked until present (or pass force:true)`,
    }];
  },
};
