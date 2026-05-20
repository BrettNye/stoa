// src/core/lint-checks/move-portable-has-scope.ts
//
// T9 of specialist-agent-substrate DAG. Attributed to profile-gastly.
//
// MOVE_PORTABLE_HAS_SCOPE (severity: warning) — self-registering Group A rule.
//
// Fires when a move under wikis/_agents/moves/ has `scope_wiki:` set
// (non-empty). Portable moves are scope-less by definition — having a
// scope_wiki value leaks an implementation detail and may confuse deployment
// layering. Warning (not error) per spec §4.6: misconfigured frontmatter is
// recoverable and the move still functions.
//
// Spec reference: wikis/_meta/specs/2026-05-19-specialist-agent-substrate-design.md §4.6
// Plan reference: wikis/_meta/plans/2026-05-19-specialist-agent-substrate-dag.md §T9

import { registerLintCheck } from "../lint-check.js";
import { walkMoves } from "./move-scope-wiki-folder-mismatch.js";
import type { Diagnostic } from "../lint.js";

export const MOVE_PORTABLE_HAS_SCOPE_CODE = "MOVE_PORTABLE_HAS_SCOPE";

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(x => String(x)) : [];
}

registerLintCheck({
  code: MOVE_PORTABLE_HAS_SCOPE_CODE,
  run(ctx, _idx, input): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    for (const { wiki, moveId, frontmatter } of walkMoves(ctx.vaultPath, input.wiki)) {
      if (wiki !== "_agents") continue;             // only portable moves
      const scopeWiki = asStringArray(frontmatter.scope_wiki);
      if (scopeWiki.length === 0) continue;          // absent → no diagnostic
      const pageId = String(frontmatter.id ?? moveId);
      diagnostics.push({
        severity: "warning",
        code: MOVE_PORTABLE_HAS_SCOPE_CODE,
        page_id: pageId,
        wiki,
        message:
          `portable move "${pageId}" under wikis/_agents/moves/ has scope_wiki ` +
          `${JSON.stringify(scopeWiki)}. Portable moves are unscoped by definition.`,
        suggestion:
          `remove scope_wiki from the move's frontmatter, or relocate the move to ` +
          `wikis/${scopeWiki[0]}/moves/ if it's actually wiki-local.`,
      });
    }
    return diagnostics;
  },
});
