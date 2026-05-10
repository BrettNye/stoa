import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { registerLintCheck } from "../lint-check.js";
import { parseFrontmatter } from "../frontmatter.js";
import type { Diagnostic } from "../lint.js";

/**
 * MISSING_CURATION_PRIORITY (severity: warning) — corpus-wide rule.
 *
 * Fires on `status: draft` + `author: agent:*` pages that are aged > N days
 * with no `curation_priority` frontmatter field. The field is the substrate's
 * bandwidth-management primitive (see
 * `[[wikis/_meta/concepts/concept-curation-priority]]`); humans triage by
 * reading priority annotations rather than reading the drafts themselves.
 * Drafts older than the threshold without an annotation force explicit
 * triage rather than silent accumulation.
 *
 * Plan reference: wikis/_meta/plans/2026-05-08-substrate-adoption-quickwin.md
 * §W1.3.
 *
 * Scope rules:
 *   - Only `status: draft` + `author: agent:*` pages — human-authored content
 *     and non-draft content are out of scope.
 *   - Default age threshold: 7 days. Becomes config-driven via
 *     `_meta/lint-config.yaml` once that infrastructure lands.
 *   - The check reads frontmatter from disk for each candidate (the index
 *     does not carry `author` or `curation_priority`).
 */

export const MISSING_CURATION_PRIORITY_CODE = "MISSING_CURATION_PRIORITY";

// Default age threshold in days. Becomes config-driven via
// `_meta/lint-config.yaml` key `curation_priority.staleness_days`.
export const DEFAULT_STALENESS_DAYS = 7;

interface CandidatePage {
  pageId: string;
  wiki: string;
  filePath: string;
  fmCreated: string | undefined;
  fmAuthor: string | undefined;
  fmCurationPriority: unknown;
}

/**
 * Pure helper. Given a list of candidate pages and a "today" reference date,
 * returns one diagnostic per page that:
 *   - is authored by an `agent:*` (other authorship → out of scope)
 *   - has no `curation_priority` set (or has an unrecognized value)
 *   - has `created` older than `staleness_days` ago
 *
 * Pages with malformed `created` dates are skipped (the format-lint rules
 * cover those separately).
 */
export function findMissingCurationPriority(
  candidates: CandidatePage[],
  today: Date,
  stalenessDays: number = DEFAULT_STALENESS_DAYS,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const cutoffMs = today.getTime() - stalenessDays * 24 * 60 * 60 * 1000;

  for (const c of candidates) {
    const author = c.fmAuthor ?? "";
    if (!author.startsWith("agent:")) continue;

    // Skip if curation_priority is set to a recognized value.
    const cp = c.fmCurationPriority;
    if (cp === "high" || cp === "medium" || cp === "low") continue;

    const created = c.fmCreated;
    if (!created || typeof created !== "string") continue;
    const createdMs = Date.parse(created);
    if (isNaN(createdMs)) continue;
    if (createdMs > cutoffMs) continue;

    const ageDays = Math.floor((today.getTime() - createdMs) / (24 * 60 * 60 * 1000));
    out.push({
      severity: "warning",
      code: MISSING_CURATION_PRIORITY_CODE,
      page_id: c.pageId,
      wiki: c.wiki,
      message:
        `agent-authored draft has no curation_priority annotation and has been pending ${ageDays} day(s). ` +
        `Either set curation_priority (high|medium|low) in frontmatter or curate (promote/archive).`,
      suggestion:
        "set curation_priority: high|medium|low in frontmatter, or curate the draft (promote/archive). Subagents should self-assess priority on draft creation.",
    });
  }
  return out;
}

registerLintCheck({
  code: MISSING_CURATION_PRIORITY_CODE,
  run(ctx, idx, input) {
    const today = ctx.today ?? new Date();
    const candidates: CandidatePage[] = [];

    for (const page of idx.pages) {
      if (page.status !== "draft") continue;
      if (input.wiki && page.wiki !== input.wiki) continue;

      const fullPath = join(ctx.vaultPath, page.path);
      if (!existsSync(fullPath)) continue;
      let fm: Record<string, unknown>;
      try {
        const raw = readFileSync(fullPath, "utf8");
        fm = parseFrontmatter(raw).frontmatter as Record<string, unknown>;
      } catch {
        continue; // malformed frontmatter — other lint rules flag it
      }

      candidates.push({
        pageId: page.id,
        wiki: page.wiki,
        filePath: fullPath,
        fmCreated: typeof fm.created === "string" ? fm.created : undefined,
        fmAuthor: typeof fm.author === "string" ? fm.author : undefined,
        fmCurationPriority: fm.curation_priority,
      });
    }

    return findMissingCurationPriority(candidates, today, DEFAULT_STALENESS_DAYS);
  },
});
