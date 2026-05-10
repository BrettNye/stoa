import { registerLintCheck } from "../lint-check.js";
import type { Diagnostic } from "../lint.js";
import type { IndexedPage } from "../index.js";

/**
 * SYNTHESIS_DEBT (severity: warning) — corpus-wide rule.
 *
 * Walks `idx.pages` and finds per-wiki tag clusters where ≥ N hard-knowledge
 * pages share a tag with NO synthesis page in the same wiki covering it.
 * "Hard-knowledge" types are `concept`, `spec`, `decision` — the durable
 * thinking layer. Synthesis pages are the mid-tier hubs that distill clusters
 * into recallable views. A 3-concept cluster with no synthesis is silent
 * synthesis debt: future recall returns raw concepts, subagents re-derive
 * Brett's view per task, the graph stays radial instead of mesh.
 *
 * Authored as part of the 2026-05-08 substrate-adoption W1.2 plan. Threshold
 * is hardcoded N=3 today; becomes config-driven (`_meta/lint-config.yaml`
 * key `synthesis_debt.min_cluster_size`) when lint-config infrastructure
 * lands per the resolution-lifecycle spec.
 *
 * Diagnostic shape:
 *   - One diagnostic per (wiki, tag) cluster meeting the criteria.
 *   - `page_id` is the alphabetically-first contributing hard-knowledge id,
 *     so re-runs are stable.
 *   - `message` lists the cluster size, the tag, and a suggested synthesis
 *     title slug derived from the tag.
 *   - `suggestion` proposes the `vault.synthesize` command to address it.
 *
 * Pure-helper extraction (`findSynthesisDebt`) lets unit tests exercise the
 * rule against a synthetic IndexedPage[] without touching the filesystem.
 *
 * Per [[wikis/_meta/concepts/concept-trust-gradient-axes]] axis 7 (threshold
 * breaches), this is a structural-property rule — no content reads, just
 * frontmatter index queries — and therefore scales as the vault grows.
 */

export const SYNTHESIS_DEBT_CODE = "SYNTHESIS_DEBT";

// Default minimum cluster size. Becomes config-driven via
// `_meta/lint-config.yaml` key `synthesis_debt.min_cluster_size` once lint-
// config loading lands (resolution-lifecycle spec implementation).
export const DEFAULT_MIN_CLUSTER_SIZE = 3;

// Hard-knowledge types per `core/index.ts` KNOWLEDGE_TYPES, narrowed to the
// "durable, distillable" subset. `guide`, `source`, `idea`, `question` are
// excluded because:
//   - guide is procedural, not factual; clusters of guides don't beg for
//     synthesis the way concept/decision/spec clusters do.
//   - source is external citation; distilling 5 source pages into a synthesis
//     IS valuable (and the synthesis can pull from sources by reference), but
//     the source-tagging discipline is looser, so we'd false-positive heavily.
//     Future variant of this rule could opt-in source pages.
//   - idea/question are open-by-default and shouldn't trigger debt.
const HARD_KNOWLEDGE_TYPES = new Set(["concept", "spec", "decision"]);

interface ClusterDebt {
  wiki: string;
  tag: string;
  contributingIds: string[]; // sorted, hard-knowledge only
}

/**
 * Pure helper. Given an IndexedPage list and a min cluster size, returns
 * one ClusterDebt per (wiki, tag) where:
 *   - count of hard-knowledge pages with this tag in this wiki is ≥ minSize
 *   - AND no synthesis page in this wiki has this tag
 *
 * Pages without tags or without a wiki are skipped. Empty-string tags are
 * skipped (defensive).
 */
export function findSynthesisDebt(
  pages: IndexedPage[],
  minSize: number = DEFAULT_MIN_CLUSTER_SIZE,
): ClusterDebt[] {
  // (wiki, tag) → contributing hard-knowledge ids
  const hardClusters = new Map<string, Map<string, Set<string>>>();
  // (wiki, tag) → bool — does ANY synthesis page in this wiki have this tag
  const synthesisCovers = new Map<string, Set<string>>();

  for (const page of pages) {
    if (!page.wiki) continue;
    if (!Array.isArray(page.tags)) continue;
    const wiki = page.wiki;
    const type = String(page.type);

    if (HARD_KNOWLEDGE_TYPES.has(type)) {
      let perWiki = hardClusters.get(wiki);
      if (!perWiki) {
        perWiki = new Map<string, Set<string>>();
        hardClusters.set(wiki, perWiki);
      }
      for (const t of page.tags) {
        if (!t) continue;
        let ids = perWiki.get(t);
        if (!ids) {
          ids = new Set<string>();
          perWiki.set(t, ids);
        }
        ids.add(String(page.id));
      }
    } else if (type === "synthesis") {
      let perWiki = synthesisCovers.get(wiki);
      if (!perWiki) {
        perWiki = new Set<string>();
        synthesisCovers.set(wiki, perWiki);
      }
      for (const t of page.tags) {
        if (!t) continue;
        perWiki.add(t);
      }
    }
  }

  const out: ClusterDebt[] = [];
  for (const [wiki, perWiki] of hardClusters) {
    const covered = synthesisCovers.get(wiki) ?? new Set<string>();
    for (const [tag, ids] of perWiki) {
      if (ids.size < minSize) continue;
      if (covered.has(tag)) continue;
      out.push({
        wiki,
        tag,
        contributingIds: [...ids].sort(),
      });
    }
  }
  // Stable ordering: by wiki, then by tag.
  out.sort((a, b) => a.wiki.localeCompare(b.wiki) || a.tag.localeCompare(b.tag));
  return out;
}

function suggestedSynthesisSlug(tag: string): string {
  // Map e.g. `labor-class` → `synthesis-labor-class-overview`. Tags are
  // already kebab-case per the wiki tag-vocabulary convention.
  return `synthesis-${tag}-overview`;
}

registerLintCheck({
  code: SYNTHESIS_DEBT_CODE,
  run(_ctx, idx, input) {
    const pages = input.wiki
      ? idx.pages.filter(p => p.wiki === input.wiki)
      : idx.pages;
    const clusters = findSynthesisDebt(pages, DEFAULT_MIN_CLUSTER_SIZE);
    const diagnostics: Diagnostic[] = [];
    for (const c of clusters) {
      const slug = suggestedSynthesisSlug(c.tag);
      diagnostics.push({
        severity: "warning",
        code: SYNTHESIS_DEBT_CODE,
        page_id: c.contributingIds[0],
        wiki: c.wiki,
        message:
          `${c.contributingIds.length} hard-knowledge pages share tag "${c.tag}" in wiki "${c.wiki}" with no covering synthesis. ` +
          `Contributing ids: ${c.contributingIds.slice(0, 5).join(", ")}` +
          (c.contributingIds.length > 5 ? `, ... (+${c.contributingIds.length - 5} more)` : ""),
        suggestion:
          `run \`vault.synthesize ${c.tag} --wiki=${c.wiki}\` to compile a synthesis page (suggested id: ${slug})`,
      });
    }
    return diagnostics;
  },
});
