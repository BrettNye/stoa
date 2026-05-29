// src/core/curate-journal.ts
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { serializeFrontmatter } from "./frontmatter.js";
import { upsertPage } from "./index.js";
import type { CurationAction } from "./curation-rule.js";

/**
 * Build the markdown body for a curation-run digest.
 *
 * Pure function — no I/O, no side effects.
 *
 * @param applied  Actions that were applied to pages.
 * @param flagged  Actions that were produced by rules but NOT applied (gated).
 */
export function composeCurationDigest(
  applied: CurationAction[],
  flagged: CurationAction[],
): string {
  const group = (as: CurationAction[]): string => {
    const by: Record<string, CurationAction[]> = {};
    for (const a of as) {
      (by[a.code] ??= []).push(a);
    }
    return Object.entries(by)
      .map(
        ([code, list]) =>
          `### ${code}\n` +
          list
            .map(a => `- [[${a.page_id}]] ${a.from_status} → ${a.to_status} — ${a.evidence}`)
            .join("\n"),
      )
      .join("\n\n");
  };

  const appliedSection =
    applied.length ? group(applied) : "_none_";

  const flaggedSection = flagged.length
    ? flagged
        .map(a => `- [[${a.page_id}]] → ${a.to_status}: ${a.flag_reason}`)
        .join("\n")
    : "_none_";

  return (
    `## Applied\n\n${appliedSection}\n\n` +
    `## Flagged — not applied\n\n${flaggedSection}`
  );
}

/**
 * Write one curation-run journal page to `<vaultPath>/wikis/<wiki>/journal/`
 * and upsert it into the index.
 *
 * The file id is `journal-YYYY-MM-DD-HHMM-curation-run`, mirroring the
 * agent-journal convention (date + time + slug).
 *
 * @returns The stable page id of the written journal entry.
 */
export async function writeCurationDigest(
  vaultPath: string,
  wiki: string,
  agentId: string,
  applied: CurationAction[],
  flagged: CurationAction[],
): Promise<string> {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toISOString().slice(11, 16).replace(":", "");
  const id = `journal-${date}-${time}-curation-run`;

  const fm: Record<string, any> = {
    id,
    title: `Curation run — ${date} ${time}`,
    type: "journal",
    wiki,
    created: now.toISOString(),
    author: `agent:${agentId}`,
  };

  const path = join(vaultPath, "wikis", wiki, "journal", `${id}.md`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeFrontmatter(fm, composeCurationDigest(applied, flagged)));
  await upsertPage(vaultPath, path);
  return id;
}
