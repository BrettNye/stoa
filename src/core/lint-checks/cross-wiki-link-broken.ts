import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { registerLintCheck } from "../lint-check.js";
import { extractWikilinks, type WikilinkRef } from "../wikilinks.js";
import { parseFrontmatter } from "../frontmatter.js";
import type { Diagnostic } from "../lint.js";

/**
 * CROSS_WIKI_LINK_BROKEN (severity:error) — walks every indexed page's body
 * and `related:` frontmatter for vault-root absolute wikilinks. For each
 * link of the form `[[wikis/<wiki>/<type>/<id>(|alias)?]]`, verify:
 *   - <wiki> is present in the index (idx.wikis).
 *   - <id> is present in the index (idx.pages).
 * The <type> segment is informational and not validated here (per Plan A).
 *
 * Code-fenced links are stripped by `extractWikilinks` and not flagged.
 * Body links and frontmatter links are both checked; the diagnostic message
 * indicates which side the broken link came from.
 *
 * Reads each page's raw markdown from disk to recover (a) the body
 * (IndexedPage carries no body content) and (b) the original frontmatter
 * `related:` array (the index does not retain it). Pages that fail to
 * parse are skipped silently — other lint checks already flag those.
 */
registerLintCheck({
  code: "CROSS_WIKI_LINK_BROKEN",
  run(ctx, idx, input) {
    const diagnostics: Diagnostic[] = [];

    const knownWikis = new Set(idx.wikis.map(w => w.name));
    const knownIds = new Set(idx.pages.map(p => p.id));

    for (const page of idx.pages) {
      if (input.wiki && page.wiki !== input.wiki) continue;

      const fullPath = join(ctx.vaultPath, page.path);
      if (!existsSync(fullPath)) continue;

      let body = "";
      let related: string[] = [];
      try {
        const raw = readFileSync(fullPath, "utf8");
        const parsed = parseFrontmatter(raw);
        body = parsed.body;
        const fmRelated = parsed.frontmatter.related;
        if (Array.isArray(fmRelated)) {
          related = fmRelated.map(String);
        }
      } catch {
        continue;
      }

      const refs: WikilinkRef[] = extractWikilinks(body, related);
      for (const ref of refs) {
        const wikiUnknown = !knownWikis.has(ref.wiki);
        const idUnknown = !knownIds.has(ref.id);
        if (!wikiUnknown && !idUnknown) continue;

        const reasons: string[] = [];
        if (wikiUnknown) reasons.push(`unknown wiki "${ref.wiki}"`);
        if (idUnknown) reasons.push(`unknown id "${ref.id}"`);
        const where = ref.source === "frontmatter" ? "frontmatter related:" : "body";
        const message =
          `broken cross-wiki link in ${where}: ${ref.raw} — ${reasons.join(", ")}`;

        diagnostics.push({
          severity: "error",
          code: "CROSS_WIKI_LINK_BROKEN",
          page_id: page.id,
          wiki: page.wiki,
          message,
          suggestion: wikiUnknown
            ? `verify the target wiki name; rewrite-links can fix renamed wikis`
            : `verify the target id; the page may have been renamed (check _index/aliases.json) or moved`,
        });
      }
    }

    return diagnostics;
  },
});
