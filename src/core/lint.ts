import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadIndex } from "./index.js";
import { parseFrontmatter } from "./frontmatter.js";
import { POKEMON_TYPES, STAGE_TO_AUTONOMY } from "./pokemon.js";

export interface Diagnostic {
  severity: "error" | "warning" | "info";
  code: string;
  page_id?: string;
  wiki?: string;
  message: string;
  suggestion?: string;
}

export interface LintResult {
  diagnostics: Diagnostic[];
  summary: { errors: number; warnings: number; info: number };
}

export interface LintInput {
  wiki?: string;
  level?: "error" | "warning" | "info";
}

export function lint(vaultPath: string, input: LintInput = {}): LintResult {
  const diagnostics: Diagnostic[] = [];
  const idx = loadIndex(vaultPath);

  // 1. Each wiki must have map.md
  const wikis = input.wiki ? [input.wiki] : idx.wikis.map(w => w.name);
  for (const w of wikis) {
    const mapPath = join(vaultPath, "wikis", w, "map.md");
    if (!existsSync(mapPath)) {
      diagnostics.push({
        severity: "error", code: "MISSING_MAP", wiki: w,
        message: `wiki "${w}" has no map.md`,
        suggestion: `create wikis/${w}/map.md (use new-wiki template if rebuilding)`
      });
    }
  }

  // 2. Pages with labeled snippets must have implementation:
  for (const p of idx.pages) {
    if (input.wiki && p.wiki !== input.wiki) continue;
    const fullPath = join(vaultPath, p.path);
    if (!existsSync(fullPath)) continue;
    const raw = readFileSync(fullPath, "utf8");
    const hasSnippet = /```\w+\s+snippet:[a-z0-9-]+/i.test(raw);
    if (hasSnippet) {
      const i = raw.indexOf("\n---\n", 4);
      const fmText = raw.slice(0, i);
      if (!/^implementation:/m.test(fmText)) {
        diagnostics.push({
          severity: "warning", code: "SNIPPET_NO_IMPLEMENTATION",
          page_id: p.id, wiki: p.wiki,
          message: `page has labeled snippet but no implementation: field`,
          suggestion: `add implementation: pointing at canonical source files`
        });
      }
    }
  }

  // 3. Filename != id (skip map.md)
  for (const p of idx.pages) {
    if (input.wiki && p.wiki !== input.wiki) continue;
    if (p.type === "map") continue;
    const filename = p.path.split("/").pop() ?? "";
    const stem = filename.replace(/\.md$/, "");
    if (stem !== p.id) {
      diagnostics.push({
        severity: "warning", code: "FILENAME_ID_MISMATCH",
        page_id: p.id, wiki: p.wiki,
        message: `filename "${filename}" does not match id "${p.id}"`,
        suggestion: `rename file to ${p.id}.md`
      });
    }
  }

  // 4. Channel format violations
  for (const p of idx.pages) {
    if (input.wiki && p.wiki !== input.wiki) continue;
    if (p.channel && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.channel)) {
      diagnostics.push({
        severity: "warning", code: "BAD_CHANNEL_FORMAT",
        page_id: p.id, wiki: p.wiki,
        message: `channel "${p.channel}" must be lowercase kebab-case`
      });
    }
  }

  // v1.5 — agents-wiki specific checks (profiles + moves)
  if (!input.wiki || input.wiki === "_agents") {
    lintAgentsWiki(vaultPath, diagnostics);
  }

  const summary = {
    errors: diagnostics.filter(d => d.severity === "error").length,
    warnings: diagnostics.filter(d => d.severity === "warning").length,
    info: diagnostics.filter(d => d.severity === "info").length
  };
  return { diagnostics, summary };
}

function lintAgentsWiki(vaultPath: string, diagnostics: Diagnostic[]): void {
  const profilesDir = join(vaultPath, "wikis", "_agents", "profiles");
  const movesDir = join(vaultPath, "wikis", "_agents", "moves");

  // Build move-id index
  const knownMoves = new Set<string>();
  if (existsSync(movesDir)) {
    for (const entry of readdirSync(movesDir, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(movesDir, entry.name, "SKILL.md"))) {
        knownMoves.add(entry.name);
      }
    }
  }

  // Profile checks
  if (existsSync(profilesDir)) {
    for (const file of readdirSync(profilesDir)) {
      if (!file.endsWith(".md")) continue;
      const path = join(profilesDir, file);
      try {
        const raw = readFileSync(path, "utf8");
        const { frontmatter: fm } = parseFrontmatter(raw);
        const id = String(fm.id ?? file.replace(/\.md$/, ""));

        // PROFILE_TYPE_INVALID
        if (fm.pokemon_type && !(POKEMON_TYPES as readonly string[]).includes(String(fm.pokemon_type))) {
          diagnostics.push({
            severity: "warning",
            code: "PROFILE_TYPE_INVALID",
            page_id: id,
            wiki: "_agents",
            message: `pokemon_type "${fm.pokemon_type}" not in 18-canon enum`,
            suggestion: "use one of: " + POKEMON_TYPES.join(", ")
          });
        }

        // MOVESET_REFERENCE
        if (Array.isArray(fm.moveset)) {
          for (const moveId of fm.moveset) {
            if (!knownMoves.has(String(moveId))) {
              diagnostics.push({
                severity: "warning",
                code: "MOVESET_REFERENCE",
                page_id: id,
                wiki: "_agents",
                message: `moveset references unknown move "${moveId}"`,
                suggestion: "remove the reference or create the move"
              });
            }
          }
        }

        // MOVESET_OVERSIZED
        if (Array.isArray(fm.moveset) && fm.moveset.length > 8) {
          diagnostics.push({
            severity: "warning",
            code: "MOVESET_OVERSIZED",
            page_id: id,
            wiki: "_agents",
            message: `profile has ${fm.moveset.length} moves (>8 — metaphor coherence)`,
            suggestion: "consider splitting responsibilities across multiple profiles"
          });
        }

        // EVOLUTION_AUTONOMY_MISMATCH
        const stage = String(fm.evolution_stage ?? "basic");
        const autonomy = String(fm.autonomy_level ?? "");
        if (autonomy && stage in STAGE_TO_AUTONOMY) {
          const expected = STAGE_TO_AUTONOMY[stage as keyof typeof STAGE_TO_AUTONOMY];
          if (autonomy !== expected) {
            diagnostics.push({
              severity: "warning",
              code: "EVOLUTION_AUTONOMY_MISMATCH",
              page_id: id,
              wiki: "_agents",
              message: `evolution_stage=${stage} typically maps to autonomy_level=${expected}, but is "${autonomy}"`,
              suggestion: "verify the override is intentional"
            });
          }
        }
      } catch { /* skip malformed */ }
    }
  }

  // Move checks
  if (existsSync(movesDir)) {
    for (const entry of readdirSync(movesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillPath = join(movesDir, entry.name, "SKILL.md");
      if (!existsSync(skillPath)) continue;
      try {
        const raw = readFileSync(skillPath, "utf8");
        const { frontmatter: fm } = parseFrontmatter(raw);
        const id = String(fm.id ?? entry.name);

        // MOVE_NAME_ID_DRIFT
        const expectedName = id.startsWith("move-") ? id.slice("move-".length) : id;
        if (fm.name && fm.name !== expectedName) {
          diagnostics.push({
            severity: "warning",
            code: "MOVE_NAME_ID_DRIFT",
            page_id: id,
            wiki: "_agents",
            message: `move name "${fm.name}" does not match id stem "${expectedName}"`,
            suggestion: "align name with id for SKILL.md spec compliance"
          });
        }

        // MOVE_DESCRIPTION_MISSING
        const status = String(fm.status ?? "draft");
        if ((status === "active" || status === "accepted") && !fm.description) {
          diagnostics.push({
            severity: "warning",
            code: "MOVE_DESCRIPTION_MISSING",
            page_id: id,
            wiki: "_agents",
            message: `active/accepted move missing 'description' (SKILL.md spec)`,
            suggestion: "add a description: line to frontmatter"
          });
        }
      } catch { /* skip */ }
    }
  }
}
