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
 * Returns the canonical filename for a given type + slug input.
 * Mirrors the profile-<slug>.md convention for each type.
 */
export function filenameForType(type: NoteType, input: string): string {
  const slug = slugify(input);
  switch (type) {
    case "trainer":
      return `trainer-${slug}.md`;
    default:
      return `${type}-${slug}.md`;
  }
}
