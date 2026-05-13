// vault-mcp/src/core/claims-index.ts
//
// task-claims-sidecar-builder — builds the `_index/claims.json` inverted
// index over every claim page in the vault. Spec §5.4 defines the bucket
// shape (`by_profile`, `by_move`, `by_scope_wiki`, `by_tag`, `global`) plus
// `generated_at` and `schema_version: 1`.
//
// Plan reference:
// `wikis/_meta/plans/2026-05-02-vault-mcp-claims-plan-1-foundation-dag.md`
// §task-claims-sidecar-builder.
//
// Implementation note: the plan template called `store.scanAll(vaultPath)`
// directly, but `ClaimsStore.scanAll` is a private helper on `ClaimsStore`.
// We do our own disk walk over `wikis/<wiki>/claim/*.md` and load each via
// the public `ClaimsStore.read()` path, which keeps the parsing rules (Date
// normalization, tier-tolerant `ClaimDraft` parsing, malformed-skip) in one
// place.

import { promises as fs } from "node:fs";
import path from "node:path";
import { ClaimsStore } from "./claims.js";
import type { ClaimsIndex } from "../types/claims-index.js";

export type { ClaimsIndex };

/**
 * Walk every wiki's `claim/` folder and emit the inverted index. Only
 * `status: "active"` claims are bucketed; superseded/retracted/draft pages
 * are skipped silently (the same posture as `ClaimsStore.findByIdentity`).
 *
 * "Globalness" is defined per spec §5.4 as having all of `profile`, `move`,
 * and `scope_wiki` empty. `tags` are NOT considered when deciding whether a
 * claim is global — a tags-only claim is still global, and tag entries are
 * additionally indexed under `by_tag`.
 */
export async function buildClaimsIndex(vaultPath: string): Promise<ClaimsIndex> {
  const idx: ClaimsIndex = {
    by_profile: {},
    by_move: {},
    by_scope_wiki: {},
    by_tag: {},
    by_authored_by: {},
    global: [],
    generated_at: new Date().toISOString(),
    schema_version: 2,
  };

  const push = (m: Record<string, string[]>, k: string, v: string) => {
    (m[k] ??= []).push(v);
  };

  const store = new ClaimsStore();
  const wikisDir = path.join(vaultPath, "wikis");
  const wikis = await listDir(wikisDir);
  for (const wiki of wikis) {
    const claimDir = path.join(wikisDir, wiki, "claim");
    const entries = await listDir(claimDir);
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const id = entry.slice(0, -3);
      const claim = await store.read(vaultPath, id);
      if (!claim) continue; // malformed or absent — skip
      if (claim.status !== "active") continue;
      for (const p of claim.profile) push(idx.by_profile, p, claim.id);
      for (const m of claim.move) push(idx.by_move, m, claim.id);
      for (const w of claim.scope_wiki) push(idx.by_scope_wiki, w, claim.id);
      for (const t of claim.tags) push(idx.by_tag, t, claim.id);
      if (claim.authored_by) push(idx.by_authored_by, claim.authored_by, claim.id);
      if (
        !claim.profile.length &&
        !claim.move.length &&
        !claim.scope_wiki.length
      ) {
        // Tags-only is still global — see spec §5.4.
        idx.global.push(claim.id);
      }
    }
  }

  return idx;
}

/**
 * Persist the sidecar to `<vault>/_index/claims.json` via tmp+rename. Atomic
 * on the same filesystem (the temp lives in `_index/`, sibling to the
 * destination). Mirrors the rationale in `core/claims.atomicWrite` and the
 * sidecar locking pattern in `core/index-locking.ts`.
 */
export async function writeClaimsIndex(
  vaultPath: string,
  idx: ClaimsIndex,
): Promise<void> {
  const dir = path.join(vaultPath, "_index");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "claims.json");
  const tmp = `${file}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(idx, null, 2), "utf8");
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}
