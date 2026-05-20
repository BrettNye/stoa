import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { registerLintCheck } from "../lint-check.js";
import { parseFrontmatter } from "../frontmatter.js";
import { scopeHash } from "../scope-hash.js";
import type { Diagnostic } from "../lint.js";

/**
 * CLAIM_KEY_COLLISION (severity:warning) — corpus-wide rule.
 *
 * Two ACTIVE claims that share the identity tuple `(key, scope_hash)` are a
 * collision. `vault_claim` prevents this on the write path; this rule catches
 * manual hand-edits and git-merge artifacts where two branches each created
 * an active claim for the same identity.
 *
 * Plan reference: §task-lint-key-collision in
 * `wikis/_meta/plans/2026-05-02-vault-mcp-claims-plan-1-foundation-dag.md`.
 *
 * Scope rules (mirrors plan acceptance criteria):
 *   - Only active-vs-active counts. A superseded/retracted/draft claim sharing
 *     identity with an active one is fine — it is the past, not a duplicate.
 *   - `scope_hash` is the labelled hash of {profile, move, scope_wiki, tags}
 *     (see `core/scope-hash.ts`). Order-independent within each dimension,
 *     dimension-collision-resistant across dimensions.
 *   - One diagnostic per colliding tuple, naming every active id in the
 *     bucket. The diagnostic is attached to the alphabetically-first id so
 *     re-runs are stable.
 *
 * The registered `LintCheck.run` hydrates each claim's frontmatter from disk
 * (the index does not retain claim-specific fields like `key` or `profile`)
 * and delegates to the pure helper `findClaimKeyCollisions`. Tests can call
 * the helper directly with `makePage` stubs without touching the filesystem.
 */

export const CLAIM_KEY_COLLISION_CODE = "CLAIM_KEY_COLLISION";

interface ClaimLike {
  frontmatter: Record<string, unknown>;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

/**
 * Pure helper. Given a list of pages (any shape with `frontmatter`), returns
 * one diagnostic per colliding identity tuple of active claims. Non-claim
 * pages and non-active claims are ignored.
 */
export function findClaimKeyCollisions(pages: ClaimLike[]): Diagnostic[] {
  const buckets = new Map<string, string[]>();

  for (const p of pages) {
    const fm = p?.frontmatter;
    if (!fm) continue;
    if (fm.type !== "claim") continue;
    if (fm.status !== "active") continue;

    const id = String(fm.id ?? "");
    if (!id) continue;
    const key = String(fm.key ?? "");
    if (!key) continue;

    const hash = scopeHash(
      asStringArray(fm.profile),
      asStringArray(fm.move),
      asStringArray(fm.scope_wiki),
      asStringArray(fm.tags),
    );
    const tupleKey = `${key}|${hash}`;
    const ids = buckets.get(tupleKey) ?? [];
    ids.push(id);
    buckets.set(tupleKey, ids);
  }

  const diagnostics: Diagnostic[] = [];
  for (const [tupleKey, ids] of buckets) {
    if (ids.length < 2) continue;
    const sorted = [...ids].sort();
    diagnostics.push({
      severity: "warning",
      code: CLAIM_KEY_COLLISION_CODE,
      page_id: sorted[0],
      message:
        `active claims share identity tuple (${tupleKey}): ${sorted.join(", ")}. ` +
        `Resolve via vault_claim --revalidate or supersession.`,
      suggestion:
        "exactly one active claim should hold each (key, scope) tuple — supersede the older claim or retract the duplicate.",
    });
  }
  return diagnostics;
}

registerLintCheck({
  code: CLAIM_KEY_COLLISION_CODE,
  run(ctx, idx, input) {
    // Source 1 — `idx.pages`. Reindex doesn't currently include `claim` in
    // NoteType, so claim files are typically absent here; this branch exists
    // for forward-compat with the later wave that adds claim to NoteType,
    // and to keep this rule's existing unit test (which injects synthetic
    // claim entries into idx.pages) working.
    const claims: ClaimLike[] = [];
    const seenIds = new Set<string>();
    const idToWiki = new Map<string, string>();
    for (const page of idx.pages) {
      if (String(page.type) !== "claim") continue;
      if (input.wiki && page.wiki !== input.wiki) continue;
      const fullPath = join(ctx.vaultPath, page.path);
      if (!existsSync(fullPath)) continue;
      try {
        const raw = readFileSync(fullPath, "utf8");
        const { frontmatter } = parseFrontmatter(raw);
        claims.push({ frontmatter });
        const id = String(frontmatter.id ?? page.id);
        if (id) {
          seenIds.add(id);
          idToWiki.set(id, page.wiki);
        }
      } catch {
        // Malformed frontmatter — skip; other lint checks flag those.
      }
    }

    // Source 2 — disk walk of `wikis/<wiki>/claim/*.md`. Mirrors
    // claim-effective-below-floor.ts / claim-tag-repo-prefix-malformed.ts so
    // the rule fires under `vault_lint` end-to-end (the production callsite)
    // without depending on whether reindex picks up claim files.
    const wikisDir = join(ctx.vaultPath, "wikis");
    if (existsSync(wikisDir)) {
      let wikiNames: string[];
      try {
        wikiNames = readdirSync(wikisDir, { withFileTypes: true })
          .filter(e => e.isDirectory())
          .map(e => e.name);
      } catch {
        wikiNames = [];
      }
      const targetWikis = input.wiki ? wikiNames.filter(w => w === input.wiki) : wikiNames;
      for (const wiki of targetWikis) {
        const claimDir = join(wikisDir, wiki, "claim");
        if (!existsSync(claimDir)) continue;
        let entries: string[];
        try {
          entries = readdirSync(claimDir);
        } catch {
          continue;
        }
        for (const file of entries) {
          if (!file.endsWith(".md")) continue;
          const filePath = join(claimDir, file);
          try {
            const raw = readFileSync(filePath, "utf8");
            const { frontmatter } = parseFrontmatter(raw);
            if (frontmatter.type !== "claim") continue;
            const id = String(frontmatter.id ?? file.replace(/\.md$/, ""));
            // De-dupe against Source 1 so the unit test (which builds idx.pages
            // referencing the same on-disk file) doesn't double-count.
            if (id && seenIds.has(id)) continue;
            claims.push({ frontmatter });
            if (id) {
              seenIds.add(id);
              idToWiki.set(id, wiki);
            }
          } catch {
            // Malformed frontmatter — skip.
          }
        }
      }
    }

    const findings = findClaimKeyCollisions(claims);
    // Stamp the wiki on each finding. The page_id was set in the helper from
    // the alphabetically-first id; map it back via the merged idToWiki.
    return findings.map((d) => ({
      ...d,
      wiki: d.page_id ? idToWiki.get(d.page_id) : undefined,
    }));
  },
});
