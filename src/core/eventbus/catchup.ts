import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "../frontmatter.js";
import { matchers } from "./matchers/index.js";
import { matchFilter } from "./match.js";
import type { Cursor, Filter, VaultEvent } from "./types.js";
import { Cursor as CursorNs } from "./types.js";

export interface CatchupResult {
  events: VaultEvent[];
  cursor: Cursor;
}

/** Recursive .md walk under <vault>/wikis/. Node 20+ readdirSync supports {recursive: true}. */
function walkWikiMarkdown(vaultPath: string): string[] {
  const root = join(vaultPath, "wikis");
  if (!existsSync(root)) return [];
  const entries = readdirSync(root, { recursive: true, withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.endsWith(".md")) continue;
    const dir = (e as any).parentPath ?? (e as any).path ?? root;
    out.push(join(dir, e.name));
  }
  return out;
}

export async function catchupSince(
  vaultPath: string,
  filters: Filter[],
  since: Cursor | undefined,
): Promise<CatchupResult> {
  const sinceIso = since ? CursorNs.toIso(since) : undefined;
  const events: VaultEvent[] = [];
  let maxMtime = sinceIso ?? new Date(0).toISOString();

  for (const absPath of walkWikiMarkdown(vaultPath)) {
    let matcher: typeof matchers[number] | null = null;
    let key: { wiki: string; id: string } | null = null;
    for (const m of matchers) {
      const k = m.deriveKey(absPath, vaultPath);
      if (k) { matcher = m; key = k; break; }
    }
    if (!matcher || !key) continue;

    let st;
    try { st = statSync(absPath); } catch { continue; }
    const mtimeIso = st.mtime.toISOString();
    if (sinceIso && mtimeIso <= sinceIso) continue;
    if (mtimeIso > maxMtime) maxMtime = mtimeIso;

    let parsed;
    try { parsed = parseFrontmatter(readFileSync(absPath, "utf8")); } catch { continue; }
    const decision = matcher.decide(parsed, undefined, "add");
    if (!decision.emit) continue;

    const event: VaultEvent = {
      source: matcher.source,
      wiki: key.wiki,
      id: key.id,
      path: absPath,
      change_kind: "add",
      mtime: mtimeIso,
      ...decision.enrichment,
    };
    if (filters.some(f => matchFilter(f, event))) events.push(event);
  }

  events.sort((a, b) => a.mtime.localeCompare(b.mtime));
  return { events, cursor: CursorNs.fromIso(maxMtime) };
}
