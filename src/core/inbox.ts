import { writeFileSync, readdirSync, readFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { serializeFrontmatter } from "./frontmatter.js";
import { slugify, typeFolder } from "./ids.js";
import type { NoteType } from "./frontmatter.js";

export interface CaptureResult {
  id: string;
  path: string;
  wiki: string;
}

export function captureInbox(vaultPath: string, wiki: string, thought: string): CaptureResult {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toISOString().slice(11, 16).replace(":", "");
  const slug = slugify(thought.split(/\s+/).slice(0, 6).join(" "));
  const id = `${date}-${time}-${slug || "thought"}`;
  const path = join(vaultPath, "wikis", wiki, "inbox", `${id}.md`);
  writeFileSync(path, thought + "\n");
  return { id, path, wiki };
}

export function listInbox(vaultPath: string, wiki: string): string[] {
  const dir = join(vaultPath, "wikis", wiki, "inbox");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith(".md"))
    .map(f => join(dir, f));
}

export interface PromoteInput {
  inbox_path: string;
  type: NoteType;
  id: string;
  wiki: string;
  title?: string;
}

export interface PromoteResult {
  from: string;
  to: string;
  id: string;
}

export function promoteInboxItem(vaultPath: string, input: PromoteInput): PromoteResult {
  const original = readFileSync(input.inbox_path, "utf8");
  const today = new Date().toISOString().slice(0, 10);
  const fm = {
    id: input.id,
    title: input.title ?? input.id.replace(/^[a-z]+-/, "").replace(/-/g, " "),
    type: input.type,
    wiki: input.wiki,
    status: "draft",
    created: today
  };
  const dest = join(vaultPath, "wikis", input.wiki, typeFolder(input.type), `${input.id}.md`);
  // Bug-2026-05-15 #2 fix — auto-create the target type subdirectory if it
  // doesn't exist. Without this, a process-inbox batch that included a
  // type whose folder hadn't been scaffolded (e.g. `questions/` in a wiki
  // that predated the question note type) would error ENOENT mid-batch
  // and silently skip the rest. Matches the new-wiki eager-scaffold fix
  // (bug #3); this guard keeps existing wikis safe regardless of scaffold
  // age.
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, serializeFrontmatter(fm, original.trim() + "\n"));
  unlinkSync(input.inbox_path);
  return { from: input.inbox_path, to: dest, id: input.id };
}
