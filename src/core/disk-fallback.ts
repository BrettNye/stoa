import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter.js";

const TYPE_FOLDERS = [
  "concepts", "guides", "decisions", "specs", "synthesis",
  "ideas", "questions", "sources", "journal", "tasks",
  "profiles", "plans"
] as const;

export interface DiskFindResult {
  frontmatter: Record<string, any>;
  body: string;
  path: string;  // absolute path
  wiki: string;
  type: string;
}

/**
 * v1.7 §5.4 — Generalized disk-scan fallback for id-resolution.
 *
 * Walks every `wikis/<wiki>/<type-folder>/<id>.md` looking for the requested
 * id. Returns the first match where the frontmatter's `id` field matches the
 * requested id (defensive guard against renamed-but-not-updated files).
 *
 * Used by start, recall, lint, merge-queue, list-wikis as a fallback for
 * `loadIndex`-based lookups that miss because the index hasn't been refreshed.
 *
 * Synchronous + cheap (single targeted readFile per candidate match).
 *
 * @returns null if no match found
 */
export function findOnDisk(vaultPath: string, id: string): DiskFindResult | null {
  const wikisDir = join(vaultPath, "wikis");
  if (!existsSync(wikisDir)) return null;

  for (const wiki of readdirSync(wikisDir)) {
    if (!statSync(join(wikisDir, wiki)).isDirectory()) continue;
    for (const typeFolder of TYPE_FOLDERS) {
      const candidate = join(wikisDir, wiki, typeFolder, `${id}.md`);
      if (!existsSync(candidate)) continue;
      try {
        const raw = readFileSync(candidate, "utf8");
        const { frontmatter, body } = parseFrontmatter(raw);
        if (String(frontmatter.id ?? "") !== id) continue;  // defensive id-mismatch guard
        return {
          frontmatter,
          body,
          path: candidate,
          wiki,
          type: String(frontmatter.type ?? typeFolder)
        };
      } catch { /* skip malformed */ }
    }

    // Moves use a directory layout: wikis/<wiki>/moves/<id>/SKILL.md
    const skillPath = join(wikisDir, wiki, "moves", id, "SKILL.md");
    if (existsSync(skillPath)) {
      try {
        const raw = readFileSync(skillPath, "utf8");
        const { frontmatter, body } = parseFrontmatter(raw);
        if (String(frontmatter.id ?? "") === id) {
          return { frontmatter, body, path: skillPath, wiki, type: String(frontmatter.type ?? "move") };
        }
      } catch { /* skip */ }
    }
  }

  return null;
}
