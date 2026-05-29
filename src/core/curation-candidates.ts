import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter, toIsoDate } from "./frontmatter.js";
import type { VaultIndex } from "./index.js";
import type { CandidatePage } from "./curation-rule.js";
import type { NoteType } from "./frontmatter.js";

const ELIGIBLE = new Set(["draft", "active", "open"]); // open = question lifecycle

/**
 * Walk `idx.pages` for curation-eligible statuses (draft/active/open), read
 * each page's frontmatter from disk (the index omits author, implementation,
 * etc.), count inbound links from `idx.links`, and return `CandidatePage[]`.
 *
 * Malformed-frontmatter and missing-file pages are silently skipped so the
 * caller never has to guard against I/O errors. Lint owns those warnings.
 *
 * @param vaultPath  Absolute path to the vault root.
 * @param idx        Loaded VaultIndex (pages + links already in memory).
 * @param wiki       Optional wiki filter — when provided, only pages whose
 *                   `wiki` field matches are included.
 */
export function loadCandidates(
  vaultPath: string,
  idx: VaultIndex,
  wiki?: string,
): CandidatePage[] {
  const out: CandidatePage[] = [];

  for (const p of idx.pages) {
    if (!ELIGIBLE.has(p.status)) continue;
    if (wiki && p.wiki !== wiki) continue;

    const full = join(vaultPath, p.path);
    if (!existsSync(full)) continue;

    let fm: Record<string, unknown>;
    try {
      fm = parseFrontmatter(readFileSync(full, "utf8")).frontmatter as Record<string, unknown>;
    } catch {
      // malformed → lint owns it; skip silently
      continue;
    }

    const author = typeof fm.author === "string" ? fm.author : "";
    const inbound = idx.links[p.id]?.inbound ?? [];

    out.push({
      page_id: p.id,
      wiki: p.wiki,
      type: p.type as NoteType,
      path: p.path,
      status: p.status,
      author_class: author.startsWith("agent:") ? "agent" : "human",
      created: typeof fm.created === "string" ? fm.created : (fm.created instanceof Date ? toIsoDate(fm.created) : undefined),
      updated: typeof fm.updated === "string" ? fm.updated : (fm.updated instanceof Date ? toIsoDate(fm.updated) : undefined),
      inbound_link_count: inbound.length,
      frontmatter: fm,
    });
  }

  return out;
}
