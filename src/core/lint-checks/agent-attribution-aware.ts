import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { registerLintCheck } from "../lint-check.js";
import { parseFrontmatter } from "../frontmatter.js";
import { resolveCurrent } from "../aliases.js";
import type { Diagnostic } from "../lint.js";

/**
 * AGENT_ATTRIBUTION_DRIFT (severity:warning) — alias-tolerant counterpart to
 * the inline ALIAS_DRIFT check in core/lint.ts. Where ALIAS_DRIFT flags
 * recent journals authored under an aliased-old id (signaling a stale local
 * CLAUDE.md fragment), this check flags recent journals authored under an
 * id that is *neither* a current profile *nor* a recorded historical alias
 * (signaling a truly-orphan attribution — typo, deleted profile, etc.).
 *
 * Resolution algorithm for each journal's `author: agent:<X>`:
 *   1. If `wikis/_agents/profiles/profile-<X>.md` exists → OK (current id).
 *   2. Else `resolveCurrent(profile-<X>) !== profile-<X>` AND target file
 *      exists → OK (recorded alias).
 *   3. Else → emit AGENT_ATTRIBUTION_DRIFT.
 *
 * Recency window: 30 days from journal `created`. Older journals don't
 * count — the goal is to nudge live agents, not retro-flag history.
 *
 * Iteration: walks `wikis/<*>/journal/*.md` from disk (mirrors the inline
 * ALIAS_DRIFT pattern); does not rely on `idx.pages` so the check stays
 * functional even if the journal type filter were to change in the index.
 */
registerLintCheck({
  code: "AGENT_ATTRIBUTION_DRIFT",
  run(ctx, _idx, input) {
    const diagnostics: Diagnostic[] = [];
    const vaultPath = ctx.vaultPath;
    const profilesDir = join(vaultPath, "wikis", "_agents", "profiles");
    const wikisDir = join(vaultPath, "wikis");
    if (!existsSync(wikisDir)) return diagnostics;

    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const targetWikis = input.wiki ? [input.wiki] : readdirSync(wikisDir);

    for (const wikiName of targetWikis) {
      const journalDir = join(wikisDir, wikiName, "journal");
      if (!existsSync(journalDir)) continue;

      for (const file of readdirSync(journalDir)) {
        if (!file.endsWith(".md")) continue;
        const path = join(journalDir, file);
        try {
          const raw = readFileSync(path, "utf8");
          const { frontmatter: fm } = parseFrontmatter(raw);
          const author = String(fm.author ?? "");
          if (!author.startsWith("agent:")) continue;

          const created = new Date(String(fm.created ?? ""));
          if (Number.isNaN(created.getTime()) || created < cutoff) continue;

          const bare = author.slice("agent:".length);
          if (!bare) continue;

          // Step 1: current profile id?
          const directProfile = join(profilesDir, `profile-${bare}.md`);
          if (existsSync(directProfile)) continue;

          // Step 2: alias overlay — does `profile-<bare>` resolve to a
          // current id whose file exists?
          const lookupKey = `profile-${bare}`;
          const current = resolveCurrent(vaultPath, lookupKey);
          if (current !== lookupKey) {
            const aliasedProfile = join(profilesDir, `${current}.md`);
            if (existsSync(aliasedProfile)) continue;
          }

          // Step 3: orphan attribution.
          diagnostics.push({
            severity: "warning",
            code: "AGENT_ATTRIBUTION_DRIFT",
            page_id: String(fm.id ?? file.replace(/\.md$/, "")),
            wiki: wikiName,
            message: `journal authored as ${author} but no profile-${bare} exists and no alias entry maps it to a current profile`,
            suggestion: `verify the agent id; create profile-${bare}, or record the rename via vault_evolve-profile`
          });
        } catch {
          // skip malformed
        }
      }
    }

    return diagnostics;
  },
});
