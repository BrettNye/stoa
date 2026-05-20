// src/core/lint-checks/move-scope-wiki-missing.ts
//
// T9 of specialist-agent-substrate DAG. Attributed to profile-gastly.
//
// MOVE_SCOPE_WIKI_MISSING (severity: warning) — self-registering Group A rule.
//
// Fires when a wiki-local move (under wikis/<wiki>/moves/, where <wiki> is NOT
// `_agents`) has no `scope_wiki:` set or set to an empty array. Wiki-local
// moves must declare their scope so deployment layering and other rules can
// reason about them.
//
// Portable moves (wikis/_agents/moves/) are excluded — they SHOULD have no
// scope_wiki (and MOVE_PORTABLE_HAS_SCOPE handles the inverse).
//
// Spec reference: wikis/_meta/specs/2026-05-19-specialist-agent-substrate-design.md §4.6
// Plan reference: wikis/_meta/plans/2026-05-19-specialist-agent-substrate-dag.md §T9

import { registerLintCheck } from "../lint-check.js";
import { walkMoves } from "./move-scope-wiki-folder-mismatch.js";
import type { Diagnostic } from "../lint.js";

export const MOVE_SCOPE_WIKI_MISSING_CODE = "MOVE_SCOPE_WIKI_MISSING";

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(x => String(x)) : [];
}

registerLintCheck({
  code: MOVE_SCOPE_WIKI_MISSING_CODE,
  run(ctx, _idx, input): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    for (const { wiki, moveId, frontmatter } of walkMoves(ctx.vaultPath, input.wiki)) {
      if (wiki === "_agents") continue;             // portable moves are exempt
      const scopeWiki = asStringArray(frontmatter.scope_wiki);
      if (scopeWiki.length > 0) continue;            // present → no diagnostic
      const pageId = String(frontmatter.id ?? moveId);
      diagnostics.push({
        severity: "warning",
        code: MOVE_SCOPE_WIKI_MISSING_CODE,
        page_id: pageId,
        wiki,
        message:
          `wiki-local move "${pageId}" under wikis/${wiki}/moves/ has no scope_wiki. ` +
          `Add scope_wiki: [${wiki}] to declare its scope.`,
        suggestion:
          `add scope_wiki: [${wiki}] to the move's SKILL.md frontmatter.`,
      });
    }
    return diagnostics;
  },
});
