import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface AliasEntry {
  current: string;
  history: string[];   // chronological; first is the original id
}

export type AliasIndex = Record<string, AliasEntry>;

function aliasesPath(vaultPath: string): string {
  return join(vaultPath, "_index", "aliases.json");
}

export function readAliases(vaultPath: string): AliasIndex {
  const p = aliasesPath(vaultPath);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")) as AliasIndex;
  } catch {
    return {};
  }
}

function writeAliases(vaultPath: string, aliases: AliasIndex): void {
  mkdirSync(join(vaultPath, "_index"), { recursive: true });
  writeFileSync(aliasesPath(vaultPath), JSON.stringify(aliases, null, 2));
}

/**
 * Record that `oldId` has been renamed to `newId`. Updates every entry whose
 * `current` was `oldId` to point to `newId`, and adds the rename pair.
 */
export function recordRename(vaultPath: string, oldId: string, newId: string): void {
  const aliases = readAliases(vaultPath);

  // Find prior history (any entry whose current is oldId)
  const priorHistory: string[] = [];
  for (const [orig, entry] of Object.entries(aliases)) {
    if (entry.current === oldId) {
      // This original id was previously renamed to oldId; chain it forward
      const chainedHistory = [...entry.history, oldId].filter((v, i, a) => a.indexOf(v) === i);
      aliases[orig] = { current: newId, history: chainedHistory };
      if (entry.history.length > 0) {
        priorHistory.push(...entry.history);
      }
    }
  }

  // The oldId itself becomes part of the history under its own key
  const existingForOld = aliases[oldId];
  const history = existingForOld
    ? [...existingForOld.history, oldId].filter((v, i, a) => a.indexOf(v) === i)
    : [oldId];

  aliases[oldId] = { current: newId, history };

  writeAliases(vaultPath, aliases);
}

/**
 * Returns all historical ids (including the input itself) that should
 * resolve to the same identity. Used by recall, channel-tail, etc.
 */
export function expandAliases(vaultPath: string, id: string): string[] {
  const aliases = readAliases(vaultPath);
  const current = resolveCurrent(vaultPath, id);

  const out = new Set<string>([id, current]);
  for (const [orig, entry] of Object.entries(aliases)) {
    if (entry.current === current) {
      out.add(orig);
      for (const h of entry.history) out.add(h);
    }
  }
  return [...out];
}

/**
 * Returns the current canonical id given any historical id.
 */
export function resolveCurrent(vaultPath: string, id: string): string {
  const aliases = readAliases(vaultPath);
  return aliases[id]?.current ?? id;
}
