import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadIndex } from "./index.js";

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

  const summary = {
    errors: diagnostics.filter(d => d.severity === "error").length,
    warnings: diagnostics.filter(d => d.severity === "warning").length,
    info: diagnostics.filter(d => d.severity === "info").length
  };
  return { diagnostics, summary };
}
