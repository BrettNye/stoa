// vault-mcp/src/core/agent-memory.ts
//
// Pure ranking + filtering + scope-derivation engine for `vault_agent-memory`.
// Spec: wikis/_meta/specs/2026-05-13-agent-memory-design.md §5-§8.
//
// Exports:
//   agentMemory(vaultPath, input): AgentMemoryResult  — synchronous, pure (except FS reads)
//
// Design notes:
// - effectiveConfidence imported from ./decay.js (not re-implemented)
// - ClaimsIndex imported from ../types/claims-index.js
// - Sidecar-first-with-disk-walk-fallback mirrors list-claims.ts posture

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { effectiveConfidence } from "./decay.js";
import { formatSourceTypeTag, formatAgentMemoryBullet } from "./claim-render.js";
import { ClaimDraft, type ClaimSourceType } from "../types/claim.js";
import type { ClaimsIndex } from "../types/claims-index.js";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type DetailLevel = "summary" | "truncated" | "full";

export interface AgentMemoryInput {
  agent_id: string;
  task?: string;
  tags?: string[];
  scope_wiki?: string[];
  token_budget?: number;
  limit?: number;
  detail?: DetailLevel;
  include_questions?: boolean;
  /** Test seam — clock injection. Defaults to `new Date()` in production. */
  today?: Date;
}

export interface AgentMemoryClaim {
  id: string;
  key: string;
  summary: string;
  body: string;
  effective_confidence: number;
  scope_match_score: number;
  score: number;
  authored_by: string;
  /**
   * specialist-agent-substrate spec §5.5 — claim provenance. Always populated
   * on output; falls back to "lived" when the underlying claim has no
   * `source_type` field (back-compat for pre-T1 indexed claims).
   */
  source_type: ClaimSourceType;
  /**
   * Rendered `[<source_type> | <effective_confidence:.2>]` tag (spec §5.5).
   * Provided so callers do not need to re-derive the format string —
   * informational only; does NOT influence ranking.
   */
  source_type_tag: string;
  /**
   * Canonical rendered claim line as the agent reads it (spec §5.5):
   *
   *   `[<source_type> | <eff_conf>] <body-or-summary>`
   *
   * The source_type tag is concatenated INLINE with the claim body so the
   * agent's literal output looks like the spec example
   * "[curricular | 0.62] In CrewTracks integration tests use the harness at
   * apps/api/test/db-harness.ts." rather than two separately-addressable
   * fields that a downstream consumer would have to join itself.
   *
   * `source_type` and `source_type_tag` remain available as structured fields
   * for callers that want to parse the components separately; `rendered` is
   * the canonical surface the spec mandates be a single string.
   */
  rendered: string;
}

export interface AgentMemoryResult {
  agent_id: string;
  scope_used: {
    tags: string[];
    scope_wiki: string[];
    profile: string[];
  };
  claims: AgentMemoryClaim[];
  questions?: Array<{
    id: string;
    title: string;
    tags: string[];
    created: string;
  }>;
  total_pool_size: number;
  truncated: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const CONFIDENCE_FLOOR = 0.4;
const DEFAULT_LIMIT = 10;
const TRUNCATED_BODY_MAX = 200;
const FULL_BODY_MAX = 2000; // ~500 tokens at chars/4

// ─────────────────────────────────────────────────────────────────────────────
// Minimal internal claim shape (what we need after parsing)
// ─────────────────────────────────────────────────────────────────────────────

interface RawClaim {
  id: string;
  key: string;
  status: string;
  confidence: number;
  last_validated: string;
  profile: string[];
  scope_wiki: string[];
  tags: string[];
  authored_by: string;
  body: string;
  summary?: string;
  /** spec §5.5 — provenance tag. Defaults to "lived" via ClaimDraft schema. */
  source_type: ClaimSourceType;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

export function agentMemory(vaultPath: string, input: AgentMemoryInput): AgentMemoryResult {
  const today = input.today ?? new Date();

  // Step 1: Normalize agent_id (strip "agent:" or "profile-" prefix)
  const agentId = normalizeAgentId(input.agent_id);

  // Step 2: Derive scope (§6.1 + §6.2)
  // Precedence: explicit args > task-derived > empty
  let taskDerivedTags: string[] = [];
  let taskDerivedWiki: string | null = null;

  if (input.task) {
    const taskScope = readTaskScope(vaultPath, input.task);
    if (taskScope !== null) {
      taskDerivedTags = taskScope.tags;
      taskDerivedWiki = taskScope.wiki;
    }
    // On failure (null), soft-fall-through — treat as if task were absent (§8.3)
  }

  // scope_wiki: explicit arg wins (§6.1 step 1); otherwise task-derived wiki as single-element array
  const scopeWiki: string[] =
    input.scope_wiki !== undefined && input.scope_wiki.length > 0
      ? input.scope_wiki
      : taskDerivedWiki !== null
        ? [taskDerivedWiki]
        : input.scope_wiki ?? [];

  // tags: explicit tags merged with task-derived (§6.2 — concat + dedupe)
  const rawTags = [...(input.tags ?? []), ...taskDerivedTags];
  const scopeTags: string[] = [...new Set(rawTags)];

  const scopeUsed = {
    tags: scopeTags,
    scope_wiki: scopeWiki,
    profile: [agentId],
  };

  const detail: DetailLevel = input.detail ?? "truncated";
  const limit = input.limit ?? DEFAULT_LIMIT;

  // Step 3: Load sidecar; determine fallback posture for authored_by
  const sidecarPath = path.join(vaultPath, "_index", "claims.json");
  const sidecar = readSidecar(sidecarPath);
  const hasAuthoredByBucket = sidecar !== null && sidecar.schema_version === 2 && !!sidecar.by_authored_by;

  // Step 4: Gather candidates per the three-way OR predicate + wiki AND-guard
  const candidates = gatherCandidates(
    vaultPath,
    agentId,
    scopeTags,
    scopeWiki,
    sidecar,
    hasAuthoredByBucket,
  );

  // Step 5 & 6: Compute effective_confidence, apply below-floor cutoff, compute
  // scope_match, score, then sort
  interface ScoredClaim {
    raw: RawClaim;
    effConf: number;
    scopeMatch: number;
    score: number;
  }

  const scored: ScoredClaim[] = [];
  for (const raw of candidates) {
    const effConf = effectiveConfidence(
      { confidence: raw.confidence, last_validated: raw.last_validated, status: raw.status },
      today,
    );
    if (effConf < CONFIDENCE_FLOOR) continue;

    const scopeMatch = computeScopeMatch(raw, agentId, scopeTags, scopeWiki);
    const score = effConf * (1 + scopeMatch);
    scored.push({ raw, effConf, scopeMatch, score });
  }

  const totalPoolSize = scored.length;

  // Sort: score desc, tie-break by id asc
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.raw.id.localeCompare(b.raw.id);
  });

  // Step 7: Apply token_budget packing OR limit cap
  const tokenBudget = input.token_budget;
  const packed: ScoredClaim[] = [];
  let usedTokens = 0;
  let truncated = false;

  for (const s of scored) {
    if (packed.length >= limit) {
      truncated = true;
      break;
    }

    if (tokenBudget !== undefined) {
      const bodyText = renderBody(s.raw.body, detail);
      const claimTokens = estimateTokens(bodyText) + estimateTokens(s.raw.summary ?? firstSentence(s.raw.body));
      if (usedTokens + claimTokens > tokenBudget && packed.length > 0) {
        truncated = true;
        break;
      }
      usedTokens += claimTokens;
    }

    packed.push(s);
  }

  if (!truncated && totalPoolSize > packed.length) {
    truncated = true;
  }

  // Step 8: Build AgentMemoryResult
  const claims: AgentMemoryClaim[] = packed.map((s) => {
    const bodyRendered = renderBody(s.raw.body, detail);
    const summary = s.raw.summary ?? firstSentence(s.raw.body);

    // spec §5.5 — canonical rendered string the agent reads. The body source
    // for the inline concatenation is the summary (compact, single line) when
    // present, falling back to the rendered body. `detail: "summary"` returns
    // an empty body string, but `summary` is always populated (or derived
    // from firstSentence), so the rendered line is never just a bare tag.
    const renderedBody = summary.length > 0 ? summary : bodyRendered;

    return {
      id: s.raw.id,
      key: s.raw.key,
      summary,
      body: bodyRendered,
      effective_confidence: s.effConf,
      scope_match_score: s.scopeMatch,
      score: s.score,
      authored_by: s.raw.authored_by,
      // spec §5.5 — informational provenance tag rendered per claim. Does NOT
      // alter the ranking algorithm above; computed at output-build time so
      // ranking code is unchanged.
      source_type: s.raw.source_type,
      source_type_tag: formatSourceTypeTag({
        source_type: s.raw.source_type,
        effective_confidence: s.effConf,
      }),
      rendered: formatAgentMemoryBullet({
        source_type: s.raw.source_type,
        effective_confidence: s.effConf,
        body: renderedBody,
      }),
    };
  });

  return {
    agent_id: agentId,
    scope_used: scopeUsed,
    claims,
    total_pool_size: totalPoolSize,
    truncated,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Candidate gathering
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gather all candidate claims satisfying the three-way OR predicate + wiki AND-guard.
 *
 * Three OR branches:
 *   1. authored_by == "agent:<A>"   — I wrote it
 *   2. profile contains <A>         — targeted at me
 *   3. profile empty AND scope_match(C, S) > 0  — global, scope-matched
 *
 * All branches are further filtered by the wiki AND-guard:
 *   C.scope_wiki is empty OR C.scope_wiki intersects S.scope_wiki
 *
 * And by status:
 *   C.status == "active"
 */
function gatherCandidates(
  vaultPath: string,
  agentId: string,
  scopeTags: string[],
  scopeWiki: string[],
  sidecar: ClaimsIndex | null,
  hasAuthoredByBucket: boolean,
): RawClaim[] {
  const seen = new Set<string>();
  const results: RawClaim[] = [];

  const addClaim = (c: RawClaim) => {
    if (seen.has(c.id)) return;
    if (c.status !== "active") return;
    // Wiki AND-guard
    if (c.scope_wiki.length > 0 && scopeWiki.length > 0) {
      if (!intersects(c.scope_wiki, scopeWiki)) return;
    } else if (c.scope_wiki.length > 0 && scopeWiki.length === 0) {
      // Claim is wiki-scoped but caller provides no wiki scope → skip
      // (universal claims — scope_wiki empty — still pass through)
      return;
    }
    seen.add(c.id);
    results.push(c);
  };

  // Branch 1: authored_by == "agent:<A>"
  if (hasAuthoredByBucket && sidecar) {
    // Use sidecar bucket
    const authoredByKey = `agent:${agentId}`;
    const authoredIds = sidecar.by_authored_by[authoredByKey] ?? [];
    for (const id of authoredIds) {
      const c = readClaimFromDisk(vaultPath, id);
      if (c && c.authored_by === authoredByKey) addClaim(c);
    }
  } else {
    // Disk walk fallback for authored_by predicate
    const authoredByKey = `agent:${agentId}`;
    for (const c of diskWalkClaims(vaultPath)) {
      if (c.authored_by === authoredByKey) addClaim(c);
    }
  }

  // Branch 2: profile contains <A>
  // Use sidecar by_profile bucket when available (present in both v1 and v2)
  if (sidecar) {
    const profileIds = sidecar.by_profile[agentId] ?? [];
    for (const id of profileIds) {
      const c = readClaimFromDisk(vaultPath, id);
      if (c && c.profile.includes(agentId)) addClaim(c);
    }
  } else {
    // Disk walk
    for (const c of diskWalkClaims(vaultPath)) {
      if (c.profile.includes(agentId)) addClaim(c);
    }
  }

  // Branch 3: profile empty AND scope_match(C, S) > 0
  // Only meaningful when there's some scope input
  if (scopeTags.length > 0 || scopeWiki.length > 0) {
    if (sidecar) {
      // Gather candidates via tag and scope_wiki buckets
      const candidateIds = new Set<string>();
      for (const tag of scopeTags) {
        for (const id of sidecar.by_tag[tag] ?? []) candidateIds.add(id);
      }
      for (const wiki of scopeWiki) {
        for (const id of sidecar.by_scope_wiki[wiki] ?? []) candidateIds.add(id);
      }
      // Also check global claims (scope_wiki empty) — they can match via tags
      for (const id of sidecar.global ?? []) candidateIds.add(id);

      for (const id of candidateIds) {
        const c = readClaimFromDisk(vaultPath, id);
        if (c && c.profile.length === 0) {
          const sm = computeScopeMatch(c, agentId, scopeTags, scopeWiki);
          if (sm > 0) addClaim(c);
        }
      }
    } else {
      // Disk walk
      for (const c of diskWalkClaims(vaultPath)) {
        if (c.profile.length === 0) {
          const sm = computeScopeMatch(c, agentId, scopeTags, scopeWiki);
          if (sm > 0) addClaim(c);
        }
      }
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ranking helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * scope_match(C, S) = jaccard(C.tags, S.tags)
 *                   + jaccard(C.scope_wiki, S.scope_wiki)
 *                   + (C.profile contains <A> ? 0.2 : 0)
 */
function computeScopeMatch(
  claim: RawClaim,
  agentId: string,
  scopeTags: string[],
  scopeWiki: string[],
): number {
  const tagJaccard = jaccard(claim.tags, scopeTags);
  const wikiJaccard = jaccard(claim.scope_wiki, scopeWiki);
  const profileBoost = claim.profile.includes(agentId) ? 0.2 : 0;
  return tagJaccard + wikiJaccard + profileBoost;
}

/** Jaccard similarity: |A ∩ B| / |A ∪ B|. Returns 0 when both sets are empty. */
function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const x of setA) {
    if (setB.has(x)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

// ─────────────────────────────────────────────────────────────────────────────
// Body rendering
// ─────────────────────────────────────────────────────────────────────────────

function renderBody(rawBody: string, detail: DetailLevel): string {
  const trimmed = rawBody.trim();

  switch (detail) {
    case "summary":
      return "";

    case "truncated": {
      if (trimmed.length <= TRUNCATED_BODY_MAX) return trimmed;
      return trimmed.slice(0, TRUNCATED_BODY_MAX) + "(more...)";
    }

    case "full": {
      if (trimmed.length <= FULL_BODY_MAX) return trimmed;
      return trimmed.slice(0, FULL_BODY_MAX);
    }
  }
}

function firstSentence(body: string): string {
  const trimmed = body.trim();
  const match = trimmed.match(/^[^.!?\n]+[.!?]?/);
  return match ? match[0].trim() : trimmed.slice(0, 80);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent ID normalization
// ─────────────────────────────────────────────────────────────────────────────

function normalizeAgentId(raw: string): string {
  if (raw.startsWith("agent:")) return raw.slice("agent:".length);
  if (raw.startsWith("profile-")) return raw.slice("profile-".length);
  return raw;
}

// ─────────────────────────────────────────────────────────────────────────────
// Task scope reading (§6.1 + §6.2)
// ─────────────────────────────────────────────────────────────────────────────

interface TaskScope {
  tags: string[];
  wiki: string | null;
}

/**
 * Read a task page and extract tags + wiki for scope derivation.
 *
 * Searches `wikis/<wiki>/tasks/<task-id>.md` across all wikis.
 * Returns null on any failure (missing file, malformed frontmatter) — callers
 * treat null as "task absent" per §8.3 soft-warning posture.
 */
function readTaskScope(vaultPath: string, taskId: string): TaskScope | null {
  const wikisDir = path.join(vaultPath, "wikis");
  if (!existsSync(wikisDir)) return null;

  let wikis: string[];
  try {
    wikis = readdirSync(wikisDir);
  } catch {
    return null;
  }

  for (const wiki of wikis) {
    const file = path.join(wikisDir, wiki, "tasks", `${taskId}.md`);
    if (!existsSync(file)) continue;
    try {
      const raw = readFileSync(file, "utf8");
      const parsed = matter(raw);
      if (!parsed.data || Object.keys(parsed.data).length === 0) return null;
      const fm = parsed.data;
      const tags = Array.isArray(fm.tags) ? (fm.tags as unknown[]).filter((t): t is string => typeof t === "string") : [];
      const wikiField = typeof fm.wiki === "string" ? fm.wiki : null;
      return { tags, wiki: wikiField };
    } catch {
      return null;
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sidecar reading
// ─────────────────────────────────────────────────────────────────────────────

function readSidecar(filePath: string): ClaimsIndex | null {
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, "utf8");
    const json = JSON.parse(raw);
    if (typeof json !== "object" || json === null) return null;
    if (typeof json.generated_at !== "string") return null;
    return json as ClaimsIndex;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Disk reading
// ─────────────────────────────────────────────────────────────────────────────

function readClaimFromDisk(vaultPath: string, id: string): RawClaim | null {
  const wikisDir = path.join(vaultPath, "wikis");
  if (!existsSync(wikisDir)) return null;

  try {
    const wikis = readdirSync(wikisDir);
    for (const wiki of wikis) {
      const file = path.join(wikisDir, wiki, "claim", `${id}.md`);
      if (!existsSync(file)) continue;
      return parseClaimFile(file);
    }
  } catch {
    // ignore
  }
  return null;
}

/** Walk all wikis/<wiki>/claim/*.md and return parsed claims. */
function diskWalkClaims(vaultPath: string): RawClaim[] {
  const results: RawClaim[] = [];
  const wikisDir = path.join(vaultPath, "wikis");
  if (!existsSync(wikisDir)) return results;

  let wikis: string[];
  try {
    wikis = readdirSync(wikisDir);
  } catch {
    return results;
  }

  for (const wiki of wikis) {
    const claimDir = path.join(wikisDir, wiki, "claim");
    if (!existsSync(claimDir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(claimDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const file = path.join(claimDir, entry);
      const c = parseClaimFile(file);
      if (c) results.push(c);
    }
  }

  return results;
}

function parseClaimFile(file: string): RawClaim | null {
  try {
    const raw = readFileSync(file, "utf8");
    const parsed = matter(raw);
    if (!parsed.data || Object.keys(parsed.data).length === 0) return null;

    // Normalize ISO dates (gray-matter may parse them as Date objects)
    const normalized = normalizeIsoDates(parsed.data);
    const fm = ClaimDraft.parse(normalized);

    return {
      id: fm.id,
      key: fm.key,
      status: fm.status,
      confidence: fm.confidence,
      last_validated: fm.last_validated,
      profile: fm.profile ?? [],
      scope_wiki: fm.scope_wiki ?? [],
      tags: fm.tags ?? [],
      authored_by: fm.authored_by ?? "",
      body: parsed.content,
      summary: typeof normalized.summary === "string" ? normalized.summary : undefined,
      // ClaimDraft applies a "lived" default when source_type is absent in
      // frontmatter; we forward fm.source_type directly so the rendering
      // layer never sees `undefined` for back-compat claims (spec §5.5).
      source_type: fm.source_type,
    };
  } catch {
    return null;
  }
}

function normalizeIsoDates(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  for (const k of ["created", "last_validated", "updated", "retracted_at"]) {
    const v = out[k];
    if (v instanceof Date) out[k] = v.toISOString().slice(0, 10);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────────────────────

function intersects(a: string[], b: string[]): boolean {
  const setB = new Set(b);
  return a.some((x) => setB.has(x));
}
