// src/core/lint-checks/move-scope-wiki-folder-mismatch.ts
//
// T9 of specialist-agent-substrate DAG. Attributed to profile-gastly.
//
// MOVE_SCOPE_WIKI_FOLDER_MISMATCH (severity: error) — self-registering Group A rule.
//
// Fires when a move SKILL.md has `scope_wiki:` set AND its first value does not
// match the parent folder's wiki (the segment between `wikis/` and `/moves/`).
//
// Absent or empty `scope_wiki` is NOT flagged here — that's MOVE_SCOPE_WIKI_MISSING
// (wiki-local moves) or fine (portable moves under _agents).
//
// Spec reference: wikis/_meta/specs/2026-05-19-specialist-agent-substrate-design.md §4.6
// Plan reference: wikis/_meta/plans/2026-05-19-specialist-agent-substrate-dag.md §T9
//
// NOTE on the walker. Moves live at `wikis/<wiki>/moves/<move-id>/SKILL.md`
// (folder layout), which the shared `walkPagesUnder` helper in registration.ts
// does not handle (it expects flat `.md` files). Each of the four T9 rules
// uses the local `walkMoves` helper below instead.

import { existsSync, readdirSync, readFileSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { registerLintCheck } from "../lint-check.js";
import { parseFrontmatter } from "../frontmatter.js";
import type { Diagnostic } from "../lint.js";

export const MOVE_SCOPE_WIKI_FOLDER_MISMATCH_CODE = "MOVE_SCOPE_WIKI_FOLDER_MISMATCH";

export interface WalkedMove {
  wiki: string;          // parent folder wiki (segment between wikis/ and /moves/)
  moveId: string;        // folder name == move id by convention
  frontmatter: Record<string, unknown>;
}

/**
 * Walk every `wikis/<wiki>/moves/<id>/SKILL.md` under the vault. If
 * `wikiFilter` is set, restricts to that wiki. Malformed YAML and missing
 * SKILL.md files are silently skipped (other lint rules cover those).
 *
 * Local to T9 because shared `walkPagesUnder` expects flat .md files.
 */
export function* walkMoves(
  vaultPath: string,
  wikiFilter: string | undefined,
): Generator<WalkedMove> {
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
  const targetWikis = wikiFilter ? wikiNames.filter(w => w === wikiFilter) : wikiNames;

  for (const wiki of targetWikis) {
    const movesDir = join(wikisDir, wiki, "moves");
    if (!existsSync(movesDir)) continue;
    let entries: Dirent[];
    try {
      entries = readdirSync(movesDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = join(movesDir, entry.name, "SKILL.md");
      if (!existsSync(skillPath)) continue;
      let fm: Record<string, unknown>;
      try {
        const raw = readFileSync(skillPath, "utf8");
        fm = parseFrontmatter(raw).frontmatter as Record<string, unknown>;
      } catch {
        continue;
      }
      if (fm.type !== "move") continue;
      yield { wiki, moveId: entry.name, frontmatter: fm };
    }
  }
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(x => String(x)) : [];
}

registerLintCheck({
  code: MOVE_SCOPE_WIKI_FOLDER_MISMATCH_CODE,
  run(ctx, _idx, input): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    for (const { wiki, moveId, frontmatter } of walkMoves(ctx.vaultPath, input.wiki)) {
      const scopeWiki = asStringArray(frontmatter.scope_wiki);
      if (scopeWiki.length === 0) continue;          // absent → other rule handles
      if (scopeWiki[0] === wiki) continue;            // matches → ok
      const pageId = String(frontmatter.id ?? moveId);
      diagnostics.push({
        severity: "error",
        code: MOVE_SCOPE_WIKI_FOLDER_MISMATCH_CODE,
        page_id: pageId,
        wiki,
        message:
          `move "${pageId}" has scope_wiki[0] "${scopeWiki[0]}" but lives under ` +
          `wikis/${wiki}/moves/. The scope_wiki value must match the parent folder.`,
        suggestion:
          `update scope_wiki to ["${wiki}"], or relocate the move to wikis/${scopeWiki[0]}/moves/.`,
      });
    }
    return diagnostics;
  },
});
