import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { serializeFrontmatter, parseFrontmatter } from "./frontmatter.js";
import { slugify } from "./ids.js";
import { loadIndex, queryPages, upsertPage } from "./index.js";
import { resolveCurrent } from "./aliases.js";

// ---------------------------------------------------------------------------
// listAllChannels — channel enumeration for dashboard /api/channels
// ---------------------------------------------------------------------------

export interface ChannelLastEntry {
  id: string;
  channel: string;
  wiki: string;
  author: string;
  ts: string;
  excerpt: string;
  pageId: string;
}

export interface ChannelSummary {
  name: string;
  wiki: string;
  lastEntry: ChannelLastEntry | null;
  count24h: number;
}

export interface ListChannelsOptions {
  wiki?: string;
  /** Optional ISO timestamp; default = 24h ago from now. */
  since?: string;
}

export function listAllChannels(vaultPath: string, opts: ListChannelsOptions = {}): ChannelSummary[] {
  const sinceIso = opts.since ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const idx = loadIndex(vaultPath);
  const pages = queryPages(idx, { type: "journal", wiki: opts.wiki });
  const byKey = new Map<string, ChannelSummary>();
  for (const p of pages) {
    const channel = p.channel;
    if (typeof channel !== "string" || !channel) continue;
    const key = `${p.wiki}::${channel}`;
    let summary = byKey.get(key);
    if (!summary) {
      summary = { name: channel, wiki: p.wiki, lastEntry: null, count24h: 0 };
      byKey.set(key, summary);
    }
    if (p.created >= sinceIso) summary.count24h++;
    if (!summary.lastEntry || p.created > summary.lastEntry.ts) {
      // Read the file once to get author and body excerpt
      const pagePath = join(vaultPath, p.path);
      let excerpt = "";
      let author = "unknown";
      if (existsSync(pagePath)) {
        try {
          const raw = readFileSync(pagePath, "utf8");
          const { frontmatter: fm, body } = parseFrontmatter(raw);
          excerpt = body.trim().slice(0, 240);
          author = String(fm.author ?? "unknown");
        } catch {
          // leave defaults on parse error
        }
      }
      summary.lastEntry = {
        id: p.id,
        channel,
        wiki: p.wiki,
        author,
        ts: p.created,
        excerpt,
        pageId: p.id,
      };
    }
  }
  return [...byKey.values()].sort((a, b) => {
    const at = a.lastEntry?.ts ?? "";
    const bt = b.lastEntry?.ts ?? "";
    return bt.localeCompare(at);
  });
}

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

export async function postToChannel(vaultPath: string, input: PostInput): Promise<PostResult> {
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
  await upsertPage(vaultPath, path);
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
  current_alias?: string;
}

export interface TailResult {
  entries: TailEntry[];
  cursor: string;
}

export function tailChannel(vaultPath: string, input: TailInput): TailResult {
  const idx = loadIndex(vaultPath);
  const sinceRaw = input.since;
  const since = typeof sinceRaw === "string"
    ? sinceRaw
    : (sinceRaw && typeof (sinceRaw as any).toISOString === "function"
        ? (sinceRaw as any).toISOString()
        : new Date(Date.now() - 24 * 3600 * 1000).toISOString());
  const limit = input.limit ?? 50;
  const candidates = queryPages(idx, { channel: input.channel, wiki: input.wiki })
    .filter(p => (p.type === "journal" || p.type === "task") && p.created >= since)
    .sort((a, b) => a.created.localeCompare(b.created))
    .slice(0, limit);
  const entries: TailEntry[] = candidates.map(p => {
    const raw = readFileSync(join(vaultPath, p.path), "utf8");
    const { frontmatter: fm, body: parsedBody } = parseFrontmatter(raw);
    const author = String(fm.author ?? "unknown");

    let current_alias: string | undefined;
    if (author.startsWith("agent:")) {
      const bare = author.slice("agent:".length);
      const profileId = `profile-${bare}`;
      const current = resolveCurrent(vaultPath, profileId);
      if (current !== profileId) {
        current_alias = current.startsWith("profile-")
          ? current.slice("profile-".length)
          : current;
      }
    }

    const entry: TailEntry = {
      id: p.id,
      wiki: p.wiki,
      author,
      created: p.created,
      body: parsedBody
    };
    if (current_alias) entry.current_alias = current_alias;
    if (fm.session_id) entry.session_id = String(fm.session_id);
    return entry;
  });
  const cursor = entries.length > 0 ? entries[entries.length - 1].created : since;
  return { entries, cursor };
}
