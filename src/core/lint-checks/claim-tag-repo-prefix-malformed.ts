import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { registerLintCheck } from "../lint-check.js";
import { parseFrontmatter } from "../frontmatter.js";
import type { Diagnostic } from "../lint.js";

// CLAIM_TAG_REPO_PREFIX_MALFORMED (severity:info). Spec §6.3 / claims plan 1
// task-lint-tag-repo-prefix.
//
// Walks `wikis/<wiki>/claim/*.md` from disk (reindex.ts does not yet treat
// `claim` as a NoteType — see frontmatter.ts NoteType enum). For each claim
// page, scans `tags:` for entries beginning with `repo:`:
//
//   - `repo:` with no value         → info: malformed-prefix message
//   - `repo:<value>` not in registry → info: unknown-repo message
//   - `repo:<value>` in registry     → silent
//   - tags without a `repo:` prefix → ignored
//
// Short-circuits silently when `_index/deployments.json` is missing — a fresh
// vault should not be punished for not having declared any repos yet.
//
// Defensive iteration: bad frontmatter on one claim is swallowed so a single
// malformed file does not poison the whole rule.

interface DeploymentEntry {
  repo: string;
}

function loadKnownRepos(vaultPath: string): Set<string> | null {
  const sidecar = join(vaultPath, "_index", "deployments.json");
  if (!existsSync(sidecar)) return null;
  try {
    const raw = JSON.parse(readFileSync(sidecar, "utf8")) as unknown;
    // The sidecar has historically been written either as a flat array
    // (`[{repo:...}]`, the shape `mkTempVaultWithDeployments` produces) or
    // as a keyed registry (`{<pokemon>: [{repo, ...}]}`, the shape
    // `core/deployments.ts` writes for the v1.6 deployment-drift check).
    // Accept both so this rule is robust regardless of which producer
    // populated the file.
    const repos = new Set<string>();
    if (Array.isArray(raw)) {
      for (const e of raw as DeploymentEntry[]) {
        if (e && typeof e.repo === "string") repos.add(e.repo);
      }
    } else if (raw && typeof raw === "object") {
      for (const v of Object.values(raw as Record<string, unknown>)) {
        if (!Array.isArray(v)) continue;
        for (const e of v as DeploymentEntry[]) {
          if (e && typeof e.repo === "string") repos.add(e.repo);
        }
      }
    }
    return repos;
  } catch {
    return null; // unparseable sidecar — treat like missing
  }
}

registerLintCheck({
  code: "CLAIM_TAG_REPO_PREFIX_MALFORMED",
  run(ctx, _idx, input) {
    const diagnostics: Diagnostic[] = [];
    const knownRepos = loadKnownRepos(ctx.vaultPath);
    if (knownRepos === null) return diagnostics; // fresh vault — skip rule

    const wikisDir = join(ctx.vaultPath, "wikis");
    if (!existsSync(wikisDir)) return diagnostics;

    const targetWikis = input.wiki ? [input.wiki] : readdirSync(wikisDir);
    for (const wikiName of targetWikis) {
      const claimDir = join(wikisDir, wikiName, "claim");
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
        let fm: Record<string, unknown>;
        try {
          const raw = readFileSync(filePath, "utf8");
          fm = parseFrontmatter(raw).frontmatter as Record<string, unknown>;
        } catch {
          continue; // malformed file — skip, don't crash the rule
        }

        if (fm.type !== "claim") continue;

        const tags = Array.isArray(fm.tags) ? (fm.tags as unknown[]) : [];
        const pageId = String(fm.id ?? file.replace(/\.md$/, ""));
        for (const t of tags) {
          if (typeof t !== "string") continue;
          if (!t.startsWith("repo:")) continue;
          const value = t.slice("repo:".length);
          if (value.length === 0) {
            diagnostics.push({
              severity: "info",
              code: "CLAIM_TAG_REPO_PREFIX_MALFORMED",
              page_id: pageId,
              wiki: wikiName,
              message: `claim tag "${t}" has empty value after \`repo:\` prefix (malformed prefix)`,
              suggestion: `remove the bare 'repo:' tag, or replace it with 'repo:<name>' for a registered deployment`,
            });
            continue;
          }
          if (!knownRepos.has(value)) {
            diagnostics.push({
              severity: "info",
              code: "CLAIM_TAG_REPO_PREFIX_MALFORMED",
              page_id: pageId,
              wiki: wikiName,
              message: `claim tag "${t}" references unknown repo "${value}" (not in _index/deployments.json)`,
              suggestion: `register the repo via vault_bootstrap-repo, or correct the tag value to a known deployment`,
            });
          }
        }
      }
    }

    return diagnostics;
  },
});
