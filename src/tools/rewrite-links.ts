// vault-mcp/src/tools/rewrite-links.ts
//
// Phase-2 T3-5 — `vault_rewrite-links` MCP tool: bulk wikilink prefix rewrite
// across the entire vault. Pure rewrite logic lives in `core/rewrite-links.ts`
// (Wave 1 T1-2); this layer wires it to disk IO + reindex orchestration.
//
// Behaviour locked in Plan B "vault_rewrite-links semantics":
//   - Loads all pages from `_index/pages.json` via `loadIndex`.
//   - For each page, reads its body + frontmatter `related:` from disk and
//     calls `rewritePageLinks` with `normalizeScopes(input.scopes)`.
//   - Aggregates results across pages.
//   - If non-dry-run AND any rewrite happened: rewrites changed files
//     in place (preserving frontmatter via `serializeFrontmatter`), then
//     calls `reindex(vaultPath)` because `_index/links.json` etc. are
//     derived views invalidated by the rewrite.
//   - Dry-run never writes and never reindexes (`reindex_run: false`).
//   - Idempotency: a second call with the same args after a successful
//     rewrite finds no matches and returns `pages_modified: []`,
//     `total_links: 0`, `reindex_run: false`.
//
// Code-fence safety (body wikilinks inside ``` fences not rewritten) is
// handled inside `core/rewrite-links.ts`; this layer is fence-agnostic.
import { z } from "zod";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadIndex } from "../core/index.js";
import { parseFrontmatter, serializeFrontmatter } from "../core/frontmatter.js";
import { normalizeScopes, rewritePageLinks } from "../core/rewrite-links.js";
import { reindex } from "../core/reindex.js";

// Flat zod input — `z.discriminatedUnion` is incompatible with the MCP SDK
// (Plan B Note + Phase 1 carry-forward gotcha).
const Input = z.object({
  from_prefix: z.string(),
  to_prefix: z.string(),
  dry_run: z.boolean().default(false),
  scopes: z
    .array(z.enum(["body", "frontmatter", "all"]))
    .default(["all"])
});

export interface RewriteLinksOutput {
  pages_modified: { page_id: string; links_rewritten: number }[];
  total_links: number;
  reindex_run: boolean;
}

export const rewriteLinksTool = {
  name: "vault_rewrite-links",
  description:
    "Bulk-rewrite wikilink prefixes across the vault (body + frontmatter related:). Used for family migrations and wiki renames. Code-fence-safe; idempotent; dry-run by default.",
  inputSchema: Input,
  handler: async (
    input: z.infer<typeof Input>,
    ctx: { vaultPath: string }
  ): Promise<RewriteLinksOutput> => {
    const scope = normalizeScopes(input.scopes);
    const idx = loadIndex(ctx.vaultPath);

    const pagesModified: { page_id: string; links_rewritten: number }[] = [];
    let totalLinks = 0;
    // Track everything we need to write back so a single second pass over the
    // accumulated rewrites is enough — we intentionally finish the read+plan
    // phase before any writes hit disk so dry-run and non-dry-run share a code
    // path up to the write boundary.
    const pendingWrites: { absPath: string; rewritten: string }[] = [];

    for (const page of idx.pages) {
      // `page.path` is stored as a vault-relative POSIX-style path.
      const absPath = join(ctx.vaultPath, page.path);
      let raw: string;
      try {
        raw = readFileSync(absPath, "utf8");
      } catch {
        // Page missing from disk; skip silently — reindex will eventually
        // notice and drop it from the index. This mirrors lint's resilience.
        continue;
      }

      let frontmatter: Record<string, any>;
      let body: string;
      try {
        ({ frontmatter, body } = parseFrontmatter(raw));
      } catch {
        // Malformed frontmatter — skip, don't crash the whole rewrite.
        continue;
      }

      const related: string[] | undefined = Array.isArray(frontmatter.related)
        ? (frontmatter.related as string[])
        : undefined;

      const rewrite = rewritePageLinks(
        page.id,
        body,
        related,
        input.from_prefix,
        input.to_prefix,
        scope
      );
      if (rewrite === null) continue;

      pagesModified.push({
        page_id: rewrite.page_id,
        links_rewritten: rewrite.links_rewritten
      });
      totalLinks += rewrite.links_rewritten;

      if (!input.dry_run) {
        // Apply rewrite to in-memory frontmatter when frontmatter scope was
        // active AND the related: array changed; otherwise preserve the
        // original frontmatter object verbatim. `new_related` is only set
        // when the rewrite actually changed at least one entry.
        const nextFm =
          rewrite.new_related !== undefined
            ? { ...frontmatter, related: rewrite.new_related }
            : frontmatter;
        // Body is either the rewritten body (when body scope was active and
        // changed at least one link) or unchanged. `rewritePageLinks` already
        // handles that distinction internally.
        const nextBody = rewrite.new_body;
        pendingWrites.push({
          absPath,
          rewritten: serializeFrontmatter(nextFm, nextBody)
        });
      }
    }

    if (input.dry_run) {
      return {
        pages_modified: pagesModified,
        total_links: totalLinks,
        reindex_run: false
      };
    }

    // Non-dry-run: flush all writes then reindex if anything actually
    // changed. Reindex is skipped when zero pages matched (idempotency).
    for (const w of pendingWrites) {
      writeFileSync(w.absPath, w.rewritten);
    }
    const reindexRun = pendingWrites.length > 0;
    if (reindexRun) {
      await reindex(ctx.vaultPath);
    }

    return {
      pages_modified: pagesModified,
      total_links: totalLinks,
      reindex_run: reindexRun
    };
  }
};
