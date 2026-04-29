import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { serializeFrontmatter } from "./frontmatter.js";
import { slugify } from "./ids.js";
import { loadIndex, queryPages } from "./index.js";

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface PostInput {
  channel: string;
  content: string;
  wiki: string;
  agent_id: string;
  session_id?: string;
}

export interface PostResult {
  id: string;
  path: string;
  created: string;
  channel: string;
}

export function postToChannel(vaultPath: string, input: PostInput): PostResult {
  if (!KEBAB.test(input.channel)) {
    throw new Error(`channel must be kebab-case: ${input.channel}`);
  }
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toISOString().slice(11, 16).replace(":", "");
  const slug = slugify(input.content.split(/\s+/).slice(0, 6).join(" "));
  const id = `journal-${date}-${time}-${slug || "post"}`;
  const path = join(vaultPath, "wikis", input.wiki, "journal", `${id}.md`);
  const fm: Record<string, any> = {
    id,
    title: `Channel post: ${input.channel}`,
    type: "journal",
    wiki: input.wiki,
    created: now.toISOString(),
    author: `agent:${input.agent_id}`,
    channel: input.channel
  };
  if (input.session_id) fm.session_id = input.session_id;
  writeFileSync(path, serializeFrontmatter(fm, input.content));
  return { id, path, created: fm.created, channel: input.channel };
}

export interface TailInput {
  channel: string;
  since?: string;
  limit?: number;
  wiki?: string;
}

export interface TailEntry {
  id: string;
  wiki: string;
  author: string;
  created: string;
  body: string;
  session_id?: string;
}

export interface TailResult {
  entries: TailEntry[];
  cursor: string;
}

export function tailChannel(vaultPath: string, input: TailInput): TailResult {
  const idx = loadIndex(vaultPath);
  const since = input.since ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const limit = input.limit ?? 50;
  const candidates = queryPages(idx, { channel: input.channel, wiki: input.wiki })
    .filter(p => (p.type === "journal" || p.type === "task") && p.created >= since)
    .sort((a, b) => a.created.localeCompare(b.created))
    .slice(0, limit);
  const entries: TailEntry[] = candidates.map(p => {
    const raw = readFileSync(join(vaultPath, p.path), "utf8");
    const bodyStart = raw.indexOf("\n---\n", 4);
    const body = bodyStart === -1 ? "" : raw.slice(bodyStart + 5);
    return {
      id: p.id,
      wiki: p.wiki,
      author: (p as any).author ?? "unknown",
      created: p.created,
      body
    };
  });
  const cursor = entries.length > 0 ? entries[entries.length - 1].created : since;
  return { entries, cursor };
}
