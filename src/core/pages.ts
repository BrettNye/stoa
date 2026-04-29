import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { NoteType } from "./frontmatter.js";
import { parseFrontmatter, serializeFrontmatter, toIsoDate } from "./frontmatter.js";
import { isMoveDirectoryLayout, typeFolder } from "./ids.js";

export class PageNotFoundError extends Error {
  constructor(public id: string) {
    super(`page not found: ${id}`);
    this.name = "PageNotFoundError";
  }
}

export class ConflictError extends Error {
  constructor(
    public id: string,
    public expectedUpdated: string,
    public actualUpdated: string
  ) {
    super(`conflict on ${id}: expected updated=${expectedUpdated}, actual=${actualUpdated}`);
    this.name = "ConflictError";
  }
}

export interface ReadPageResult {
  id: string;
  path: string;
  frontmatter: Record<string, any>;
  body: string;
  updated: string;
}

export function pathForPage(
  vaultPath: string,
  id: string,
  type: NoteType,
  wiki: string
): string {
  if (type === "map") return join(vaultPath, "wikis", wiki, "map.md");
  const folder = typeFolder(type);
  if (isMoveDirectoryLayout(type)) {
    return join(vaultPath, "wikis", wiki, folder, id, "SKILL.md");
  }
  return join(vaultPath, "wikis", wiki, folder, `${id}.md`);
}

export function readPage(vaultPath: string, id: string, wiki: string): ReadPageResult {
  // v1.5: moves use directory layout
  const movePath = join(vaultPath, "wikis", wiki, "moves", id, "SKILL.md");
  if (existsSync(movePath)) {
    const raw = readFileSync(movePath, "utf8");
    const { frontmatter, body } = parseFrontmatter(raw);
    return {
      id, path: movePath, frontmatter, body,
      updated: toIsoDate(frontmatter.updated ?? frontmatter.created)
    };
  }

  const candidates = [
    "concepts", "guides", "decisions", "specs", "synthesis",
    "ideas", "questions", "sources", "journal", "tasks",
    "profiles" // v1.5
  ];
  for (const folder of candidates) {
    const path = join(vaultPath, "wikis", wiki, folder, `${id}.md`);
    if (existsSync(path)) {
      const raw = readFileSync(path, "utf8");
      const { frontmatter, body } = parseFrontmatter(raw);
      return {
        id, path, frontmatter, body,
        updated: toIsoDate(frontmatter.updated ?? frontmatter.created)
      };
    }
  }

  if (id === `map-${wiki}` || id === "map") {
    const mapPath = join(vaultPath, "wikis", wiki, "map.md");
    if (existsSync(mapPath)) {
      const raw = readFileSync(mapPath, "utf8");
      const { frontmatter, body } = parseFrontmatter(raw);
      return { id, path: mapPath, frontmatter, body, updated: toIsoDate(frontmatter.updated) };
    }
  }
  throw new PageNotFoundError(id);
}

export interface WritePageInput {
  id: string;
  type: NoteType;
  wiki: string;
  frontmatter: Record<string, any>;
  body: string;
  expectedUpdated?: string;
}

export interface WritePageResult {
  id: string;
  path: string;
  updated: string;
}

export function writePage(vaultPath: string, input: WritePageInput): WritePageResult {
  const path = pathForPage(vaultPath, input.id, input.type, input.wiki);
  if (existsSync(path) && input.expectedUpdated !== undefined) {
    const existing = readFileSync(path, "utf8");
    const { frontmatter: existingFm } = parseFrontmatter(existing);
    const actualUpdated = toIsoDate(existingFm.updated ?? existingFm.created);
    if (actualUpdated !== input.expectedUpdated) {
      throw new ConflictError(input.id, input.expectedUpdated, actualUpdated);
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  const fm = { ...input.frontmatter, updated: today };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeFrontmatter(fm, input.body));
  return { id: input.id, path, updated: today };
}
