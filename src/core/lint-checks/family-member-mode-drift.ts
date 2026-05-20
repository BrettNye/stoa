import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { registerLintCheck } from "../lint-check.js";
import type { Diagnostic } from "../lint.js";

/**
 * FAMILY_MEMBER_MODE_DRIFT (severity:warning) — when ≥2 wikis declare the
 * same `family:` value AND share the same `mode:`, surface ONE warning
 * naming the family, the duplicated mode, and the colliding member names.
 *
 * Per v1.6 spec §6.3 and Plan B Task 1-3: different modes within a family
 * are fine — that's the point of families (e.g., a project family with
 * `project-doc` + `idea-map` + `coordination` + `learning` members).
 * Same mode within a family is a smell — "why are these two separate
 * members if they overlap?" — and warrants either a merge or a mode change.
 *
 * Family + mode are read from each wiki's `wikis/<name>/CLAUDE.md`. Two
 * declaration formats are accepted:
 *   - markdown-bold: `**Mode:** project-doc` (current `vault_new-wiki` output).
 *   - plain key:value: `mode: project-doc` (per spec §5.1's example).
 * The check accepts both because Wave 2 Task 2-1 (proper `family:` parsing
 * in `core/wikis.ts`) and Task 2-2 (rollup in `_index/wikis.json`) may not
 * have landed yet at the time this check is dispatched in parallel. When
 * `core/family.ts` (Task 1-1) eventually exists with a richer aggregator,
 * a follow-up can swap this body without changing diagnostics.
 *
 * Wikis without CLAUDE.md, or without a parseable `family:` value, or
 * without a parseable `mode:` value, are ignored (they cannot collide).
 * Empty-string family is treated as no-family.
 */

// Two declaration shapes are accepted:
//   - markdown bold with the colon INSIDE the bold: `**Mode:** project-doc`
//     (current `vault_new-wiki` output, see core/wikis.ts).
//   - plain key:value:                              `mode: project-doc`
//     (per spec §5.1's example).
// Note the colon-inside-bold form is `**Mode:**`, NOT `**Mode**:`.
const FAMILY_LINE = /^\s*(?:\*\*\s*family\s*:\s*\*\*|family\s*:)\s*([^\s].*?)\s*$/im;
const MODE_LINE = /^\s*(?:\*\*\s*mode\s*:\s*\*\*|mode\s*:)\s*([^\s].*?)\s*$/im;

function readWikiMeta(vaultPath: string, wiki: string): { family?: string; mode?: string } {
  const claudePath = join(vaultPath, "wikis", wiki, "CLAUDE.md");
  if (!existsSync(claudePath)) return {};
  let raw: string;
  try {
    raw = readFileSync(claudePath, "utf8");
  } catch {
    return {};
  }
  const familyMatch = raw.match(FAMILY_LINE);
  const modeMatch = raw.match(MODE_LINE);
  const family = familyMatch ? familyMatch[1].trim() : undefined;
  const mode = modeMatch ? modeMatch[1].trim() : undefined;
  return {
    family: family && family.length > 0 ? family : undefined,
    mode: mode && mode.length > 0 ? mode : undefined,
  };
}

registerLintCheck({
  code: "FAMILY_MEMBER_MODE_DRIFT",
  run(ctx, idx, _input) {
    // Group wikis by family. We rely on the index for the wiki list
    // (idx.wikis) so the check sees the same vault layout the rest of the
    // pipeline does, but we read CLAUDE.md directly for `family:`/`mode:`
    // until Tasks 2-1/2-2 surface them on IndexedWiki.
    const byFamily = new Map<string, { name: string; mode: string }[]>();
    for (const w of idx.wikis) {
      const { family, mode } = readWikiMeta(ctx.vaultPath, w.name);
      if (!family) continue;
      if (!mode) continue; // can't collide without a mode to compare
      const arr = byFamily.get(family) ?? [];
      arr.push({ name: w.name, mode });
      byFamily.set(family, arr);
    }

    const diagnostics: Diagnostic[] = [];
    for (const [family, members] of byFamily) {
      if (members.length < 2) continue;
      // Group this family's members by mode. Sort members by name for
      // deterministic output across platforms (idx.wikis order is fs-driven).
      const byMode = new Map<string, string[]>();
      for (const m of members) {
        const arr = byMode.get(m.mode) ?? [];
        arr.push(m.name);
        byMode.set(m.mode, arr);
      }
      for (const [mode, names] of byMode) {
        if (names.length < 2) continue;
        const sorted = [...names].sort();
        const list = sorted.join(", ");
        diagnostics.push({
          severity: "warning",
          code: "FAMILY_MEMBER_MODE_DRIFT",
          message:
            `family "${family}" has ${sorted.length} members sharing mode "${mode}": ${list}` +
            ` — same mode within a family suggests a missed split or merge`,
          suggestion:
            `either merge the colliding members into one wiki, or differentiate by mode ` +
            `(e.g., one stays "${mode}" while the others become project-doc / coordination / learning)`,
        });
      }
    }
    return diagnostics;
  },
});
