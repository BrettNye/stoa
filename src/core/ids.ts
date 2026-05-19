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
  // Bug-2026-05-15 fix — when truncating, walk back to the previous dash so
  // we never cut mid-word (the historical bug produced trailing fragments
  // like "-on-w" and "-ensure-"). If the input already fits, return as-is
  // with any trailing dashes trimmed.
  if (normalized.length <= maxLen) {
    return normalized.replace(/-+$/, "");
  }
  // The slice could land exactly at a dash (e.g. "foo-bar-" at maxLen 8) or
  // inside a word ("foo-barxxx" at maxLen 8 → "foo-barx"). Either way: find
  // the last dash at or before maxLen, then return everything up to but not
  // including that dash. This guarantees the result ends at a word boundary.
  const slice = normalized.slice(0, maxLen);
  const lastDash = slice.lastIndexOf("-");
  if (lastDash === -1) {
    // No dash within the budget — return the slice as-is (single long word).
    // Defensive: this preserves the legacy behavior of producing *something*
    // when the entire title is one giant alphanumeric run.
    return slice;
  }
  // Walk back past any run of dashes so we don't leave a trailing dash.
  let cut = lastDash;
  while (cut > 0 && normalized[cut - 1] === "-") cut--;
  return normalized.slice(0, cut);
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
 *   - "map"       → `map.md` (fixed canonical filename; no slug, no type prefix)
 */
export type SimpleFilenameType = Exclude<NoteType, "decision" | "journal" | "move" | "map">;

/**
 * Returns the canonical filename for types that use the simple `<type>-<slug>.md`
 * convention. Types requiring date prefixes (`decision`, `journal`) or directory
 * layouts (`move`) are excluded at the TypeScript level to prevent silent
 * production of malformed filenames.
 */
export function filenameForType(type: SimpleFilenameType, input: string): string {
  return `${type}-${slugify(input)}.md`;
}
