import type { NoteType } from "./frontmatter.js";

const TYPE_FOLDERS: Record<NoteType, string> = {
  concept: "concepts",
  guide: "guides",
  decision: "decisions",
  synthesis: "synthesis",
  idea: "ideas",
  question: "questions",
  spec: "specs",
  source: "sources",
  journal: "journal",
  task: "tasks",
  move: "moves",         // v1.5
  profile: "profiles",   // v1.5
  trainer: "trainers",   // v2
  map: ""
};

export function typeFolder(type: NoteType): string {
  return TYPE_FOLDERS[type];
}

export function slugify(input: string, maxLen = 40): string {
  const normalized = input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  return normalized.slice(0, maxLen).replace(/-+$/, "");
}

export function generateId(
  type: NoteType,
  title: string,
  date?: string,
  time?: string
): string {
  const slug = slugify(title);
  if (type === "decision" && date) return `decision-${date}-${slug}`;
  if (type === "journal" && date && time) return `journal-${date}-${time}-${slug}`;
  return `${type}-${slug}`;
}

export function parseId(id: string): { type: string; rest: string } {
  const dashIdx = id.indexOf("-");
  if (dashIdx === -1) return { type: id, rest: "" };
  return { type: id.slice(0, dashIdx), rest: id.slice(dashIdx + 1) };
}

/**
 * v1.5 — moves use a directory layout (<id>/SKILL.md) rather than a single
 * .md file, to ship optional references/ and scripts/ subdirectories per the
 * SKILL.md spec. All other types use the single-file convention.
 */
export function isMoveDirectoryLayout(type: NoteType): boolean {
  return type === "move";
}

/**
 * Types whose canonical filename is simply `<type>-<slug>.md`.
 * Excluded:
 *   - "decision"  → `decision-YYYY-MM-DD-<slug>.md` (date prefix required)
 *   - "journal"   → `journal-YYYY-MM-DD-HHMM-<slug>.md` (date+time prefix required)
 *   - "move"      → `move-<slug>/SKILL.md` (directory layout, not a single file)
 */
export type SimpleFilenameType = Exclude<NoteType, "decision" | "journal" | "move">;

/**
 * Returns the canonical filename for types that use the simple `<type>-<slug>.md`
 * convention. Types requiring date prefixes (`decision`, `journal`) or directory
 * layouts (`move`) are excluded at the TypeScript level to prevent silent
 * production of malformed filenames.
 */
export function filenameForType(type: SimpleFilenameType, input: string): string {
  return `${type}-${slugify(input)}.md`;
}
