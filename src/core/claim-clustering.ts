// vault-mcp/src/core/claim-clustering.ts
//
// task-claim-clustering-helpers (Plan 2 root) — two helpers shared by
// `evolve-profile` (§8.1 steps 1-2) and `synthesize --by-agent` (§8.5
// steps 1-2).
//
// `clusterByTag` is fully pure: bucket claims by every tag they carry, drop
// buckets below `minCluster`. A claim with N tags contributes N entries.
//
// `loadActiveProfileClaims` reads the `_index/claims.json` sidecar's
// `by_profile[profileId]` index when present and falls back to a disk walk
// over `wikis/<wiki>/claim/*.md` when it isn't. Either way the loader trusts
// the on-disk frontmatter as authoritative — sidecar entries are candidate
// ids, never proof. Returned claims are filtered by status, by membership in
// the requested profile, and by the spec §6.2 effective-confidence floor
// (`config.render_min_confidence`). `today` is injected through every call
// path; this module never reads `Date.now()`.
//
// Drift notes (vs. the Plan 2 reference snippet):
//   - `ParsedClaim` is flat (extends `ClaimFrontmatter`), not nested under
//     `frontmatter`. Read fields as `c.tags`, not `c.frontmatter.tags`.
//   - `ClaimsStore.read(vaultPath, claimId)` — vaultPath is an arg, not a
//     constructor parameter.

import { promises as fs } from "node:fs";
import path from "node:path";
import { ClaimsStore, type ParsedClaim } from "./claims.js";
import { effectiveConfidence } from "./decay.js";
import type { ClaimsConfig } from "../config.js";

/**
 * Bucket claims by tag, dropping buckets that don't meet `minCluster`.
 *
 * - A claim with `tags: ["a", "b", "c"]` contributes to all three buckets.
 * - Buckets with fewer than `minCluster` members are dropped from the result.
 * - Result is order-independent: bucket membership depends on the input set,
 *   not the input order. (Within a bucket, claims appear in input order;
 *   tests treat the per-bucket arrays as sets.)
 */
export function clusterByTag(
  claims: ParsedClaim[],
  minCluster: number,
): Map<string, ParsedClaim[]> {
  const buckets = new Map<string, ParsedClaim[]>();
  for (const c of claims) {
    for (const tag of c.tags ?? []) {
      const arr = buckets.get(tag) ?? [];
      arr.push(c);
      buckets.set(tag, arr);
    }
  }
  for (const [tag, arr] of buckets) {
    if (arr.length < minCluster) buckets.delete(tag);
  }
  return buckets;
}

/**
 * Load every active claim attributed to `profileId` whose effective
 * confidence (per `effectiveConfidence(claim, today, config)`) is at or above
 * `config.render_min_confidence`.
 *
 * Sidecar-first, disk-walk fallback. The sidecar at `_index/claims.json`
 * exposes `by_profile[profileId]` as the candidate id list; if the sidecar
 * is missing entirely, a disk walk over `wikis/<wiki>/claim/*.md` produces
 * the candidate list instead. Either way, on-disk frontmatter is the
 * authority for status/profile/confidence checks — the sidecar is a hint.
 *
 * If the sidecar exists but has no entry for `profileId`, the sidecar's
 * silence is honored (return empty). This matches the spec's "prefer
 * sidecar" semantics; rebuilding the sidecar with `vault.reindex` is the
 * documented path for stale indexes.
 */
export async function loadActiveProfileClaims(
  vaultPath: string,
  profileId: string,
  today: Date,
  config: ClaimsConfig,
): Promise<ParsedClaim[]> {
  const sidecarPath = path.join(vaultPath, "_index", "claims.json");
  let candidateIds: string[];
  let sidecarPresent = true;
  try {
    const raw = await fs.readFile(sidecarPath, "utf8");
    const idx = JSON.parse(raw) as { by_profile?: Record<string, string[]> };
    candidateIds = idx.by_profile?.[profileId] ?? [];
  } catch {
    sidecarPresent = false;
    candidateIds = [];
  }

  if (!sidecarPresent) {
    // Disk walk: every wikis/<wiki>/claim/*.md is a candidate; the per-claim
    // filter below enforces profile/status/confidence.
    const wikisRoot = path.join(vaultPath, "wikis");
    const wikiNames = await fs.readdir(wikisRoot).catch(() => [] as string[]);
    for (const wikiName of wikiNames) {
      const claimDir = path.join(wikisRoot, wikiName, "claim");
      const files = await fs.readdir(claimDir).catch(() => [] as string[]);
      for (const f of files) {
        if (f.endsWith(".md")) candidateIds.push(f.slice(0, -3));
      }
    }
  }

  const store = new ClaimsStore();
  const out: ParsedClaim[] = [];
  for (const id of candidateIds) {
    const c = await store.read(vaultPath, id);
    if (!c) continue;
    if (c.status !== "active") continue;
    if (!(c.profile ?? []).includes(profileId)) continue;
    const eff = effectiveConfidence(
      {
        confidence: c.confidence,
        last_validated: c.last_validated,
        status: c.status,
      },
      today,
      {
        half_life_days: config.half_life_days,
        effective_floor: config.effective_floor,
      },
    );
    if (eff >= config.render_min_confidence) out.push(c);
  }
  return out;
}
