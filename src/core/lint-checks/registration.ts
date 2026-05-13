// vault-mcp/src/core/lint-checks/registration.ts
//
// Plan 1 §task-lint-checks-registration — wiring task.
//
// The Claims Plan 1 lint rules ship in TWO shapes by accident of the plan
// template versus the existing `core/lint-check.ts` registry contract:
//
//   Group A — already self-registers via `registerLintCheck({code, run})`:
//     - claim-key-collision.ts
//     - claim-effective-below-floor.ts
//     - claim-tag-repo-prefix-malformed.ts
//
//   Group B — exports a `{id, severity, appliesTo, check}` object per the
//   plan template, but does NOT call `registerLintCheck` itself:
//     - claim-without-evidence.ts → exports `claimWithoutEvidence`
//     - claim-with-no-scope.ts → exports `claimWithNoScope`
//     - claim-superseded-without-supersedor.ts → exports
//       `claimSupersededWithoutSupersedor`
//
// This module:
//   1. Imports Group A's three rule files for their `registerLintCheck`
//      side effect, so a single side-effect import of `registration.ts`
//      from `tools/lint.ts` wires all six rules.
//   2. Imports Group B's three rule objects, wraps each in an adapter that
//      walks `wikis/<wiki>/claim/*.md` from disk (the reindex pipeline does
//      not yet treat `claim` as a NoteType, so claim files are absent from
//      `idx.pages`), invokes the rule's `appliesTo`+`check` against parsed
//      frontmatter, maps each LintFinding → Diagnostic, and registers under
//      a per-rule registry code.
//
// Rationale for the adapter approach (vs. rewriting Group B in-place to
// call `registerLintCheck` directly): Group B's existing unit tests import
// the raw `claimWithoutEvidence` / `claimWithNoScope` /
// `claimSupersededWithoutSupersedor` objects and exercise their
// `appliesTo`+`check` methods. Keeping those objects intact means zero
// risk to the upstream tests; the adapter is the only new code surface
// this task adds.
//
// Idempotence: side-effect imports are deduped by Node's module cache;
// `registerLintCheck` is called at most once per code per process. A
// re-import is a no-op.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { registerLintCheck } from "../lint-check.js";
import { parseFrontmatter } from "../frontmatter.js";
import type { Diagnostic } from "../lint.js";
import type { PerPageRule, PerPageRulePage, LintSeverity } from "./per-page-rule.js";

// Group A — pull the side-effect registrations in via this barrel so
// `tools/lint.ts` only needs one import for the whole claims rule set.
import "./claim-key-collision.js";
import "./claim-effective-below-floor.js";
import "./claim-tag-repo-prefix-malformed.js";

// Group B — pull the rule objects in by name and adapt them.
import { claimWithoutEvidence } from "./claim-without-evidence.js";
import { claimWithNoScope } from "./claim-with-no-scope.js";
import { claimSupersededWithoutSupersedor } from "./claim-superseded-without-supersedor.js";
import { taskNotReady } from "./task-not-ready.js";

// Severity mapping. The Group B `LintFinding.severity` / `LintSeverity` enum
// is `"warn" | "error" | "info"`; the registry `Diagnostic.severity` enum is
// `"warning" | "error" | "info"`. The mismatch is `"warn"` ↔ `"warning"`.
function mapSeverity(s: LintSeverity): Diagnostic["severity"] {
  return s === "warn" ? "warning" : s;
}

// Rule-id (kebab) → registry code (UPPER_SNAKE). Stays close to the existing
// convention used by Group A and the v1.6/v1.7 lint rules.
function ruleIdToCode(id: string): string {
  return id.replace(/-/g, "_").toUpperCase();
}

// Walk `wikis/<wiki>/<subdir>/*.md` and yield parsed frontmatter for each file
// whose `type` frontmatter matches `expectedType` and passes the wiki filter.
// Malformed files are silently skipped — same posture as the rest of the lint runner.
//
// Replaces the former `walkClaimPages` (which was hardcoded to "claim"/"claim").
// Claim rules call this with subdir="claim", expectedType="claim".
// Task rules will call this with subdir="tasks", expectedType="task".
export function* walkPagesUnder(
  vaultPath: string,
  subdir: string,
  expectedType: string,
  wikiFilter: string | undefined,
): Generator<{ wiki: string; pageId: string; page: PerPageRulePage }> {
  const wikisDir = join(vaultPath, "wikis");
  if (!existsSync(wikisDir)) return;

  let wikiNames: string[];
  try {
    wikiNames = readdirSync(wikisDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  } catch {
    return;
  }

  const targetWikis = wikiFilter
    ? wikiNames.filter(w => w === wikiFilter)
    : wikiNames;

  for (const wiki of targetWikis) {
    const dir = join(wikisDir, wiki, subdir);
    if (!existsSync(dir)) continue;

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }

    for (const file of entries) {
      if (!file.endsWith(".md")) continue;
      const filePath = join(dir, file);
      let fm: Record<string, unknown>;
      try {
        const raw = readFileSync(filePath, "utf8");
        fm = parseFrontmatter(raw).frontmatter as Record<string, unknown>;
      } catch {
        continue;
      }
      if (fm.type !== expectedType) continue;
      const pageId = String(fm.id ?? file.replace(/\.md$/, ""));
      yield { wiki, pageId, page: { frontmatter: fm, filePath } };
    }
  }
}

function registerPerPageRule(rule: PerPageRule, subdir: string, expectedType: string): void {
  const code = ruleIdToCode(rule.id);
  registerLintCheck({
    code,
    run(ctx, _idx, input) {
      const diagnostics: Diagnostic[] = [];
      for (const { wiki, pageId, page } of walkPagesUnder(ctx.vaultPath, subdir, expectedType, input.wiki)) {
        if (!rule.appliesTo(page)) continue;
        const findings = rule.check(page);
        for (const f of findings) {
          diagnostics.push({
            severity: mapSeverity(f.severity),
            code,
            page_id: pageId,
            wiki,
            message: f.message,
          });
        }
      }
      return diagnostics;
    },
  });
}

// Wire each Group B rule. Order matches the plan §task-lint-checks-
// registration `depends_on:` list: no-evidence, no-scope, superseded.
// All three claim rules explicitly pass subdir="claim", expectedType="claim".
registerPerPageRule(claimWithoutEvidence, "claim", "claim");
registerPerPageRule(claimWithNoScope, "claim", "claim");
registerPerPageRule(claimSupersededWithoutSupersedor, "claim", "claim");
registerPerPageRule(taskNotReady, "tasks", "task");
