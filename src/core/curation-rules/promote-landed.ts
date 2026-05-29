import { registerCurationRule } from "../curation-rule.js";
import type { CurationCtx, CurationAction, CandidatePage } from "../curation-rule.js";

// ── Module-private helpers ───────────────────────────────────────────────────

/**
 * Parse the first `implementation[].pr` string from frontmatter.
 * Returns `undefined` if absent or the field is not a valid string.
 */
function readImplementationPr(frontmatter: Record<string, unknown>): string | undefined {
  const impl = frontmatter["implementation"];
  if (!Array.isArray(impl) || impl.length === 0) return undefined;
  const first = impl[0];
  if (first === null || typeof first !== "object") return undefined;
  const pr = (first as Record<string, unknown>)["pr"];
  if (typeof pr !== "string" || pr.trim() === "") return undefined;
  return pr;
}

/**
 * Extract a page_id from an Obsidian wikilink string.
 * Handles: `[[wikis/wiki/type/page-id]]`, `[[wikis/wiki/type/page-id|alias]]`,
 * or bare `[[page-id]]`. Returns the last path segment (stem) without `.md`.
 */
function extractPageId(wikilink: string): string {
  // Strip [[ and ]] and optional alias
  const inner = wikilink.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0];
  // Last segment, strip .md extension if present
  const parts = inner.split("/");
  return parts[parts.length - 1].replace(/\.md$/, "");
}

/**
 * True iff `c` has at least one `related:` link resolving to a `task`-type
 * candidate in `allCandidates`, AND every such task candidate has status
 * `done` or `completed`. Returns false if there are no related task candidates.
 */
function allRelatedTasksDone(c: CandidatePage, allCandidates: CandidatePage[]): boolean {
  const related = c.frontmatter["related"];
  if (!Array.isArray(related) || related.length === 0) return false;

  // Build an id-indexed map of task candidates
  const taskMap = new Map<string, CandidatePage>();
  for (const cand of allCandidates) {
    if (cand.type === "task") {
      taskMap.set(cand.page_id, cand);
    }
  }

  // Collect the related task candidates for this page
  const relatedTasks: CandidatePage[] = [];
  for (const ref of related) {
    if (typeof ref !== "string") continue;
    const id = extractPageId(ref);
    const found = taskMap.get(id);
    if (found) relatedTasks.push(found);
  }

  // Must have at least one related task; all must be done/completed
  if (relatedTasks.length === 0) return false;
  return relatedTasks.every(t => t.status === "done" || t.status === "completed");
}

/**
 * Check whether a candidate has the fields required for `accepted` status.
 * Returns a list of missing-field names (empty → ready for accepted).
 *
 * Required: non-empty `tags` array, non-empty `related` array.
 * For `decision` type: also `confidence`.
 */
function acceptedReady(c: CandidatePage): string[] {
  const miss: string[] = [];
  const fm = c.frontmatter;

  if (!Array.isArray(fm["tags"]) || (fm["tags"] as unknown[]).length === 0) {
    miss.push("tags");
  }
  if (!Array.isArray(fm["related"]) || (fm["related"] as unknown[]).length === 0) {
    miss.push("related");
  }
  if (c.type === "decision" && !fm["confidence"]) {
    miss.push("confidence");
  }
  return miss;
}

// ── Rule registration ────────────────────────────────────────────────────────

registerCurationRule({
  code: "PROMOTE_LANDED",

  run(ctx: CurationCtx): CurationAction[] {
    const out: CurationAction[] = [];

    for (const c of ctx.candidates) {
      // Only consider spec and decision types.
      // Note: "plan" is used in vault folder conventions but is not a canonical
      // NoteType enum value; cast to string for a forward-compatible check.
      const typeStr = c.type as string;
      if (typeStr !== "spec" && typeStr !== "plan" && typeStr !== "decision") continue;

      // Determine evidence and confidence
      let confidence: "high" | "medium" | undefined;
      let evidence = "";

      const prRef = readImplementationPr(c.frontmatter);
      if (prRef !== undefined) {
        const prStatus = ctx.verifyPrMerged(prRef);
        if (prStatus === "merged") {
          confidence = "high";
          evidence = `PR ${prRef} merged`;
        }
        // "open" or "unknown" → unverifiable; never promote on PR evidence alone
      }

      if (confidence === undefined && allRelatedTasksDone(c, ctx.candidates)) {
        confidence = "medium";
        evidence = "all related tasks done";
      }

      // No evidence → skip this page
      if (confidence === undefined) continue;

      // Check whether accepted-tier fields are present
      const missing = acceptedReady(c);
      const toStatus = missing.length === 0 ? "accepted" : "active";

      const action: CurationAction = {
        code: "PROMOTE_LANDED",
        page_id: c.page_id,
        wiki: c.wiki,
        from_status: c.status,
        to_status: toStatus,
        evidence,
        confidence,
        author_class: c.author_class,
        applies: false, // gate sets the final value
      };

      if (toStatus === "active" && missing.length > 0) {
        action.flag_reason = `eligible for accepted — needs ${missing.join(", ")}`;
      }

      out.push(action);
    }

    return out;
  },
});
