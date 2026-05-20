// src/core/lint-checks/claim-source-type-invalid.ts
//
// T2 of specialist-agent-substrate DAG. Attributed to profile-gastly.
//
// CLAIM_SOURCE_TYPE_INVALID (severity: error) — self-registering Group A rule.
//
// Fires when a claim file has `source_type:` present in frontmatter AND the
// value is outside the valid three-value enum: lived | curricular | retro.
//
// Absent/empty `source_type` is NOT flagged — the field is optional and
// defaults to "lived" (zod schema handles the default; this rule only
// catches hand-edits that land an out-of-enum literal).
//
// Spec reference: wikis/_meta/specs/2026-05-19-specialist-agent-substrate-design.md §5.2
// Plan reference: wikis/_meta/plans/2026-05-19-specialist-agent-substrate-dag.md §T2

import { registerLintCheck } from "../lint-check.js";
import { walkPagesUnder } from "./registration.js";
import type { Diagnostic } from "../lint.js";

export const CLAIM_SOURCE_TYPE_INVALID_CODE = "CLAIM_SOURCE_TYPE_INVALID";

const VALID_SOURCE_TYPES = new Set(["lived", "curricular", "retro"]);

registerLintCheck({
  code: CLAIM_SOURCE_TYPE_INVALID_CODE,
  run(ctx, _idx, input): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    for (const { wiki, pageId, page } of walkPagesUnder(ctx.vaultPath, "claim", "claim", input.wiki)) {
      const fm = page.frontmatter as Record<string, unknown>;
      // Only fire when source_type is explicitly present AND invalid.
      // Absent field → defaults to "lived" → no diagnostic.
      if (!Object.prototype.hasOwnProperty.call(fm, "source_type")) continue;
      const value = fm["source_type"];
      if (value === null || value === undefined || value === "") continue;
      if (VALID_SOURCE_TYPES.has(String(value))) continue;
      diagnostics.push({
        severity: "error",
        code: CLAIM_SOURCE_TYPE_INVALID_CODE,
        page_id: pageId,
        wiki,
        message:
          `claim "${pageId}" has source_type "${value}" which is not one of the valid values: ` +
          `lived, curricular, retro. Correct or remove the field.`,
        suggestion:
          "set source_type to one of: lived, curricular, retro — or remove the field entirely to default to lived.",
      });
    }
    return diagnostics;
  },
});
