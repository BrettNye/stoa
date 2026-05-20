// src/core/lint-checks/move-id-shadows-portable.ts
//
// T9 of specialist-agent-substrate DAG. Attributed to profile-gastly.
//
// MOVE_ID_SHADOWS_PORTABLE (severity: warning) — self-registering Group A rule.
//
// Fires on a wiki-local move whose id collides with any portable move's id.
// Portable wins in deployment (v1.9 contract per spec §4 risks/edge-cases);
// the diagnostic surfaces the collision on the wiki-local one so the author
// is prompted to rename.
//
// Two-pass: first collect all portable move ids (wiki === "_agents"), then
// walk again and emit one diagnostic per wiki-local move whose id is in the
// portable set.
//
// Spec reference: wikis/_meta/specs/2026-05-19-specialist-agent-substrate-design.md §4.6
// Plan reference: wikis/_meta/plans/2026-05-19-specialist-agent-substrate-dag.md §T9

import { registerLintCheck } from "../lint-check.js";
import { walkMoves } from "./move-scope-wiki-folder-mismatch.js";
import type { Diagnostic } from "../lint.js";

export const MOVE_ID_SHADOWS_PORTABLE_CODE = "MOVE_ID_SHADOWS_PORTABLE";

registerLintCheck({
  code: MOVE_ID_SHADOWS_PORTABLE_CODE,
  run(ctx, _idx, input): Diagnostic[] {
    // Pass 1: gather portable ids. ALWAYS scan _agents regardless of
    // input.wiki filter — a wiki-restricted lint run still needs to know
    // about portable moves to detect shadows from the wiki-local side.
    const portableIds = new Set<string>();
    for (const { wiki, moveId, frontmatter } of walkMoves(ctx.vaultPath, undefined)) {
      if (wiki !== "_agents") continue;
      const id = String(frontmatter.id ?? moveId);
      if (id) portableIds.add(id);
    }

    // Pass 2: emit diagnostics on wiki-local moves whose id is in the
    // portable set. Honour input.wiki for the emission scan.
    const diagnostics: Diagnostic[] = [];
    for (const { wiki, moveId, frontmatter } of walkMoves(ctx.vaultPath, input.wiki)) {
      if (wiki === "_agents") continue;             // only flag wiki-local side
      const pageId = String(frontmatter.id ?? moveId);
      if (!portableIds.has(pageId)) continue;
      diagnostics.push({
        severity: "warning",
        code: MOVE_ID_SHADOWS_PORTABLE_CODE,
        page_id: pageId,
        wiki,
        message:
          `wiki-local move "${pageId}" under wikis/${wiki}/moves/ shares its id ` +
          `with a portable move at wikis/_agents/moves/${pageId}/. Portable wins ` +
          `in deployment; the wiki-local copy is shadowed.`,
        suggestion:
          `rename the wiki-local move (e.g., add a -${wiki} suffix) and update references.`,
      });
    }
    return diagnostics;
  },
});
