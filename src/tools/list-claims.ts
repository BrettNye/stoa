// vault-mcp/src/tools/list-claims.ts
//
// task-list-claims-tool — `vault_list-claims` MCP tool.
//
// Plan reference:
// `wikis/_meta/plans/2026-05-02-vault-mcp-claims-plan-1-foundation-dag.md`
// §task-list-claims-tool. Spec reference:
// `wikis/_meta/specs/2026-05-02-vault-mcp-claims-design.md` §7.1.
//
// Pure read tool. Reads the `_index/claims.json` sidecar (built by
// `vault_reindex` via `core/claims-index.ts`) for fast bucket lookup, then
// loads each individual claim via `ClaimsStore.read` for the canonical
// per-claim shape. Falls back to a full-disk walk through the store when
// the sidecar is missing — agents shouldn't be blocked on a stale index.
//
// Filters: `by` + `value` (profile/move/tag/scope_wiki/global), `status`,
// `min_effective_confidence`, `wiki`, `source_type`. Sort: effective confidence
// descending. Defaults pulled from `getClaimsConfig`: `render_min_confidence`
// (0.4) when the caller omits `min_effective_confidence`,
// `render_default_limit` (10) when the caller omits `limit`.
//
// Registration is the responsibility of task-tools-index-registration; this
// module only exports the tool object. Tests import the handler directly.

import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ClaimsStore, type ParsedClaim } from "../core/claims.js";
import { effectiveConfidence } from "../core/decay.js";
import { getClaimsConfig } from "../config.js";
import type { ClaimsIndex } from "../types/claims-index.js";

// `min_effective_confidence` and `limit` are intentionally optional here so
// the handler can distinguish "caller omitted, fall back to config defaults"
// from "caller explicitly passed 0". Zod's `.default()` would erase that
// distinction by filling them in pre-handler.
const Input = z.object({
  by: z.enum(["profile", "move", "tag", "scope_wiki", "global", "authored_by"]).optional(),
  value: z.string().optional(),
  /** Filter by claim source_type. When set, only claims matching this source_type are returned. */
  source_type: z.enum(["lived", "curricular", "retro"]).optional(),
  min_effective_confidence: z.number().min(0).max(1).optional(),
  status: z.array(z.enum(["active", "superseded", "retracted"])).default(["active"]),
  limit: z.number().int().positive().optional(),
  wiki: z.string().optional(),
});

type ListInput = z.infer<typeof Input>;

export interface ListClaimsCtx {
  vaultPath: string;
  // Optional so DispatchCtx (which carries an optional rawConfig) is
  // structurally assignable. Handler treats undefined / non-object as
  // "use spec §6.2 defaults" via `getClaimsConfig`.
  rawConfig?: unknown;
  /** Test seam — clock injection. Defaults to `new Date()` in production. */
  today?: Date;
}

export interface ClaimEntry {
  id: string;
  key: string;
  title: string;
  body: string;
  profile: string[];
  move: string[];
  scope_wiki: string[];
  tags: string[];
  stored_confidence: number;
  effective_confidence: number;
  last_validated: string;
  days_since_validated: number;
  authored_by: string;
  evidence: string[];
  status: "active" | "superseded" | "retracted" | "draft";
  superseded_by?: string;
  supersedes: string[];
}

export const listClaimsTool = {
  name: "vault_list-claims",
  description:
    "List claims with optional dimension filter, sorted by effective confidence descending.",
  inputSchema: Input,
  handler: async (input: ListInput, ctx: ListClaimsCtx) => {
    const cfg = getClaimsConfig(ctx.rawConfig ?? {});
    const today = ctx.today ?? new Date();

    const minEff = input.min_effective_confidence ?? cfg.render_min_confidence;
    const limit = input.limit ?? cfg.render_default_limit;

    const sidecarPath = path.join(ctx.vaultPath, "_index", "claims.json");
    const store = new ClaimsStore();

    // Load candidate claims — sidecar-first (fast, the spec-blessed path),
    // disk-walk fallback when the sidecar is absent or malformed.
    let candidates: ParsedClaim[];
    let sidecarGeneratedAt: string | null = null;
    const sidecar = await readSidecar(sidecarPath);
    if (sidecar) {
      sidecarGeneratedAt = sidecar.generated_at;
      // The sidecar only indexes `active` claims (per claims-index.ts spec).
      // To honor a status filter that includes `superseded`/`retracted`, we
      // must walk disk for those too — sidecar-only lookup would miss them.
      const activeOnly = arrayEquals(input.status.slice().sort(), ["active"]);
      if (activeOnly) {
        // Bug-2026-05-19 fix — normalize the bucket value the same way
        // vault_claim (src/tools/claim.ts:127) and vault_agent-memory
        // (src/tools/agent-memory.ts:35-37) do, so a sidecar populated by
        // vault_claim (which strips `agent:` / `profile-` before storing)
        // is hit by callers who pass the prefixed form.
        const normalizedValue = normalizeBucketValue(input.by, input.value);
        const ids = selectBucket(sidecar, input.by, normalizedValue);
        const reads = await Promise.all(ids.map((id) => store.read(ctx.vaultPath, id)));
        candidates = reads.filter((c): c is ParsedClaim => c !== null);
      } else {
        candidates = await scanAllPublic(store, ctx.vaultPath);
      }
    } else {
      candidates = await scanAllPublic(store, ctx.vaultPath);
    }

    // Apply filters in order: status → wiki → bucket-membership (when no
    // sidecar) → source_type. Bucket selection is already performed
    // sidecar-side; the disk-walk path needs an explicit bucket filter to
    // match. source_type is always applied as a post-selection filter so it
    // works on both the sidecar-fast-path and the disk-walk fallback.
    let filtered = candidates.filter((c) => input.status.includes(c.status as ClaimEntry["status"] as any));
    if (input.wiki) {
      filtered = filtered.filter((c) => c.wiki === input.wiki);
    }
    if (!sidecar && input.by) {
      // Bug-2026-05-19 fix — same normalization for the disk-walk fallback
      // path so behavior is consistent regardless of whether the sidecar
      // exists.
      const normalizedValue = normalizeBucketValue(input.by, input.value);
      filtered = filtered.filter((c) => matchesBucket(c, input.by!, normalizedValue));
    }
    if (input.source_type) {
      const wantedSourceType = input.source_type;
      filtered = filtered.filter((c) => (c.source_type ?? "lived") === wantedSourceType);
    }

    // Project + decay + min-effective filter + sort.
    const projected: ClaimEntry[] = filtered
      .map((c) => projectClaim(c, today))
      .filter((c) => c.effective_confidence >= minEff)
      .sort((a, b) => b.effective_confidence - a.effective_confidence);

    return {
      claims: projected.slice(0, limit),
      total: projected.length,
      index_age_seconds: sidecarGeneratedAt
        ? ageSeconds(sidecarGeneratedAt, today)
        : null,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────

async function readSidecar(file: string): Promise<ClaimsIndex | null> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const json = JSON.parse(raw);
    if (typeof json !== "object" || json === null) return null;
    if (typeof json.generated_at !== "string") return null;
    return json as ClaimsIndex;
  } catch {
    return null;
  }
}

/**
 * Bug-2026-05-19 fix — strip `agent:` / `profile-` prefixes from the value
 * filter when the bucket dimension stores bare agent ids. This mirrors the
 * input-side normalization in `src/tools/claim.ts:127` and
 * `src/tools/agent-memory.ts:35-37`. Without this, a caller passing
 * `value: "profile-charmander"` would miss a sidecar bucket keyed
 * `by_profile["charmander"]`.
 *
 * Dimensions whose bucket keys are raw (e.g. `tag`, `move`, `scope_wiki`,
 * `authored_by`) pass through unchanged. `authored_by` in particular is
 * intentionally NOT stripped because `vault_claim` writes the raw `as:`
 * value (which may legitimately include `human:` / `agent:` prefixes —
 * see `claim.ts:247`).
 */
function normalizeBucketValue(by?: string, value?: string): string | undefined {
  if (value === undefined) return undefined;
  if (by !== "profile") return value;
  return value.replace(/^agent:/, "").replace(/^profile-/, "");
}

function selectBucket(s: ClaimsIndex, by?: string, value?: string): string[] {
  if (by === "global") return [...(s.global ?? [])];
  if (by && value) {
    const map = (s as unknown as Record<string, Record<string, string[]>>)[`by_${by}`];
    return [...(map?.[value] ?? [])];
  }
  // No filter → union of all buckets, deduped.
  const all = new Set<string>();
  for (const id of s.global ?? []) all.add(id);
  for (const m of [s.by_profile, s.by_move, s.by_scope_wiki, s.by_tag, s.by_authored_by, s.by_source_type]) {
    if (!m) continue;
    for (const ids of Object.values(m)) for (const id of ids) all.add(id);
  }
  return [...all];
}

function matchesBucket(c: ParsedClaim, by: string, value?: string): boolean {
  if (by === "global") {
    return c.profile.length === 0 && c.move.length === 0 && c.scope_wiki.length === 0;
  }
  if (!value) return true;
  switch (by) {
    case "profile":    return c.profile.includes(value);
    case "move":       return c.move.includes(value);
    case "tag":        return c.tags.includes(value);
    case "scope_wiki":  return c.scope_wiki.includes(value);
    case "authored_by": return c.authored_by === value;
    default:            return false;
  }
}

function ageSeconds(iso: string, today: Date): number {
  return Math.max(0, Math.floor((today.getTime() - new Date(iso).getTime()) / 1000));
}

function arrayEquals<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const DAY_MS = 86_400_000;

function calendarDays(fromIso: string, today: Date): number {
  const from = Date.UTC(
    +fromIso.slice(0, 4),
    +fromIso.slice(5, 7) - 1,
    +fromIso.slice(8, 10),
  );
  const to = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.max(0, Math.round((to - from) / DAY_MS));
}

function projectClaim(c: ParsedClaim, today: Date): ClaimEntry {
  const eff = effectiveConfidence(
    { confidence: c.confidence, last_validated: c.last_validated, status: c.status },
    today,
  );
  const entry: ClaimEntry = {
    id: c.id,
    key: c.key,
    title: c.title,
    body: c.body,
    profile: c.profile,
    move: c.move,
    scope_wiki: c.scope_wiki,
    tags: c.tags,
    stored_confidence: c.confidence,
    effective_confidence: eff,
    last_validated: c.last_validated,
    days_since_validated: calendarDays(c.last_validated, today),
    authored_by: c.authored_by ?? "",
    evidence: c.evidence,
    status: c.status,
    supersedes: c.supersedes,
  };
  if (c.superseded_by) entry.superseded_by = c.superseded_by;
  return entry;
}

/**
 * `ClaimsStore.scanAll` is private; the plan §task-claims-sidecar-builder
 * notes the index builder uses it as a "public-internal helper". Until that
 * helper is hoisted, we keep the disk-walk fallback narrowly scoped: walk
 * `wikis/<wiki>/claim/*.md` and read each via `ClaimsStore.read`. Single
 * consumer (sidecar-missing fallback path), so the duplication is bounded.
 */
async function scanAllPublic(store: ClaimsStore, vaultPath: string): Promise<ParsedClaim[]> {
  const wikisDir = path.join(vaultPath, "wikis");
  const out: ParsedClaim[] = [];
  let wikis: string[] = [];
  try {
    wikis = await fs.readdir(wikisDir);
  } catch {
    return [];
  }
  for (const wiki of wikis) {
    const dir = path.join(wikisDir, wiki, "claim");
    let entries: string[] = [];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const id = entry.slice(0, -3);
      const c = await store.read(vaultPath, id);
      if (c) out.push(c);
    }
  }
  return out;
}
