import { registerCurationRule } from "../curation-rule.js";
import type { CurationCtx, CurationAction, CandidatePage } from "../curation-rule.js";

/**
 * Extract the bare page id from a wikilink token.
 * Handles:
 *   - [[id]]
 *   - [[id|alias]]
 *   - [[wikis/some-wiki/type/id]]
 *   - [[wikis/some-wiki/type/id.md]]
 *   - [[wikis/some-wiki/type/id|alias]]
 */
function extractPageId(wikilink: string): string {
  // Strip [[ and ]]
  let inner = wikilink.replace(/^\[\[/, "").replace(/\]\]$/, "");
  // Strip alias (everything from the first | onward)
  const pipeIdx = inner.indexOf("|");
  if (pipeIdx !== -1) inner = inner.slice(0, pipeIdx);
  // Take only the last path segment (strip wikis/.../type/ prefix)
  const slashIdx = inner.lastIndexOf("/");
  if (slashIdx !== -1) inner = inner.slice(slashIdx + 1);
  // Strip .md suffix
  if (inner.endsWith(".md")) inner = inner.slice(0, -3);
  return inner.trim();
}

/**
 * Build a map from target-page-id → superseding-page-id by scanning every
 * candidate's frontmatter `supersedes` field (string or string[]).
 */
function buildSupersedesMap(candidates: CandidatePage[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of candidates) {
    const raw = c.frontmatter.supersedes;
    if (!raw) continue;
    const links: string[] = Array.isArray(raw) ? (raw as string[]) : [String(raw)];
    for (const link of links) {
      const targetId = extractPageId(link);
      if (targetId) {
        map.set(targetId, c.page_id);
      }
    }
  }
  return map;
}

registerCurationRule({
  code: "RESOLVE_SUPERSEDE",
  run(ctx: CurationCtx): CurationAction[] {
    const out: CurationAction[] = [];
    const supersededBy = buildSupersedesMap(ctx.candidates);

    for (const c of ctx.candidates) {
      // Check if this page is targeted by another page's supersedes: link
      const supersedingId = supersededBy.get(c.page_id);
      if (supersedingId && c.status !== "superseded") {
        out.push({
          code: "RESOLVE_SUPERSEDE",
          page_id: c.page_id,
          wiki: c.wiki,
          from_status: c.status,
          to_status: "superseded",
          evidence: `superseded by ${supersedingId}`,
          confidence: "high",
          author_class: c.author_class,
          field_patch: { superseded_by: `[[${supersedingId}]]` },
          applies: false,
        });
        continue;
      }

      // Check if this question has an explicit resolved_by: link but is not yet resolved
      if (c.type === "question" && c.status !== "resolved" && c.frontmatter.resolved_by) {
        out.push({
          code: "RESOLVE_SUPERSEDE",
          page_id: c.page_id,
          wiki: c.wiki,
          from_status: c.status,
          to_status: "resolved",
          evidence: `resolved_by ${String(c.frontmatter.resolved_by)}`,
          confidence: "high",
          author_class: c.author_class,
          applies: false,
        });
      }
    }

    return out;
  },
});
