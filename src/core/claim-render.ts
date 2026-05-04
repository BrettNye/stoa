// vault-mcp/src/core/claim-render.ts
//
// task-claim-render-shared (Claims Plan 3, Wave 1 root) — four exports
// consumed by both downstream wires (sync-skills SKILL.md rollups and the
// agent-overview rendering tools). Bundled in one module because they share
// no parallelism and have identical config + decay dependencies.
//
//   - loadActiveMoveClaims (§8.2 step 1) — sidecar-first by-move loader.
//     Mirrors `claim-clustering.loadActiveProfileClaims` exactly except keyed
//     on `by_move` and filtered on `c.move.includes(moveId)`.
//   - rankClaimsForDeployingProfile (§8.2 step 2) — pure ranker. Sorts by
//     `effectiveConfidence + (deploying ∈ claim.profile ? 0.1 : 0)`. Boost is
//     ranking-only — never stored or mutated onto the claim.
//   - formatClaimBullet (§8.2 step 4 / §8.3 same format) — per-claim bullet
//     line. Effective confidence rounded to 2 decimals; only the first entry
//     of `claim.evidence[]` is rendered.
//   - renderClaimSectionInSkillMd (§8.2 step 5) — orchestrator. Reads
//     SKILL.md frontmatter for two overrides (`claim_render: false`,
//     `claim_render_limit: <N>`), composes the others, and wraps the output
//     in `vault-claims:start..end` markers via marker-render. Idempotent on
//     identical inputs + same `today`. Removes any prior render on opt-out
//     OR on zero qualifying claims.
//
// `today` is injected through every call path; this module never reads
// `Date.now()` (matches the discipline in `core/decay.ts`).
//
// Drift notes vs. the Plan-3 reference snippet:
//   - `ParsedClaim` is flat (extends `ClaimFrontmatter`); read fields as
//     `c.move`, `c.profile`, etc. — no `c.frontmatter.*`.
//   - `ClaimsStore.read(vaultPath, claimId)` — vaultPath is a method arg.

import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { ClaimsStore, type ParsedClaim } from "./claims.js";
import { effectiveConfidence } from "./decay.js";
import {
  renderBetweenMarkers,
  removeMarkerSection,
} from "./marker-render.js";
import type { ClaimsConfig } from "../config.js";

const MARKER_NAME = "vault-claims";

/**
 * §8.2 step 1 — sidecar-first by-move loader. Mirrors
 * `loadActiveProfileClaims` exactly except keyed on `by_move` and filtered
 * on `c.move.includes(moveId)`.
 *
 * - Sidecar present + key absent → empty (sidecar silence is authoritative,
 *   no fallback to disk walk).
 * - Sidecar absent → walk every `wikis/<wiki>/claim/*.md` and let the
 *   per-claim filter drop non-matches.
 * - Per-claim filter: status === "active", move includes moveId, and
 *   effective confidence ≥ `config.render_min_confidence`.
 */
export async function loadActiveMoveClaims(
  vaultPath: string,
  moveId: string,
  today: Date,
  config: ClaimsConfig,
): Promise<ParsedClaim[]> {
  const sidecarPath = path.join(vaultPath, "_index", "claims.json");
  let candidateIds: string[];
  let sidecarPresent = true;
  try {
    const raw = await fs.readFile(sidecarPath, "utf8");
    const idx = JSON.parse(raw) as { by_move?: Record<string, string[]> };
    candidateIds = idx.by_move?.[moveId] ?? [];
  } catch {
    sidecarPresent = false;
    candidateIds = [];
  }

  if (!sidecarPresent) {
    // Disk walk: every wikis/<wiki>/claim/*.md is a candidate; the per-claim
    // filter below enforces move/status/confidence.
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
    if (!(c.move ?? []).includes(moveId)) continue;
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

/**
 * §8.2 step 2 — sort by `effective_confidence + (deploying ∈ claim.profile
 * ? 0.1 : 0)` descending. Pure: returns a new array; input is not mutated.
 * The boost is applied at ranking time only — never written back onto the
 * claim or onto the returned objects.
 */
export function rankClaimsForDeployingProfile(
  claims: ParsedClaim[],
  deployingProfileId: string,
  today: Date,
  config: ClaimsConfig,
): ParsedClaim[] {
  const score = (c: ParsedClaim) => {
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
    const boost = (c.profile ?? []).includes(deployingProfileId) ? 0.1 : 0;
    return eff + boost;
  };
  return [...claims].sort((a, b) => score(b) - score(a));
}

/**
 * §8.2 step 4 / §8.3 same-format — render a single bullet line:
 *
 *   - **`<key>`** — <body>. *(confidence <eff> as of <render-date>, validated <last_validated>, evidence: [[<first>]])*
 *
 * Effective confidence rounded to 2 decimals via `toFixed(2)`. Only the
 * first entry of `claim.evidence[]` is rendered; if `evidence` is empty the
 * clause is omitted entirely. Body falls back to `claim.body` when
 * `claim.summary` is undefined.
 */
export function formatClaimBullet(
  claim: ParsedClaim,
  today: Date,
  config: ClaimsConfig,
): string {
  const eff = effectiveConfidence(
    {
      confidence: claim.confidence,
      last_validated: claim.last_validated,
      status: claim.status,
    },
    today,
    {
      half_life_days: config.half_life_days,
      effective_floor: config.effective_floor,
    },
  );
  const renderDate = today.toISOString().slice(0, 10);
  // Collapse all internal whitespace runs (incl. embedded newlines) to a
  // single space. `.trim()` alone leaves embedded `\n` intact, which would
  // break the single-line bullet and corrupt the vault-claims:start..end
  // block when claim.body is the raw multi-line gray-matter remainder.
  const body = (claim.summary ?? claim.body ?? "")
    .trim()
    .replace(/\s*\n\s*/g, " ");
  const firstEvidence = (claim.evidence ?? [])[0];
  const evidenceClause = firstEvidence ? `, evidence: [[${firstEvidence}]]` : "";
  return `- **\`${claim.key}\`** — ${body}. *(confidence ${eff.toFixed(2)} as of ${renderDate}, validated ${claim.last_validated}${evidenceClause})*`;
}

/**
 * §8.2 step 5 — orchestrator. Reads SKILL.md frontmatter for two overrides:
 *
 *   - `claim_render: false` → remove existing markers + content, return.
 *   - `claim_render_limit: <N>` → override `config.render_default_limit`.
 *
 * Loads, ranks, caps, formats, and wraps the bullets in `vault-claims:start
 * ..end` markers via `marker-render.renderBetweenMarkers`. Idempotent: re-
 * running with the same claims and the same `today` produces a byte-
 * identical SKILL.md. On zero qualifying claims, removes any prior render
 * (cleanup behavior — symmetric with the opt-out path).
 *
 * Writes are skipped (no fs.writeFile call) when the computed output equals
 * the existing file content — this preserves mtime in the no-op case.
 */
export async function renderClaimSectionInSkillMd(args: {
  skillMdPath: string;
  moveId: string;
  deployingProfileId: string;
  vaultPath: string;
  today: Date;
  config: ClaimsConfig;
}): Promise<void> {
  const raw = await fs.readFile(args.skillMdPath, "utf8");
  const parsed = matter(raw);

  // Opt-out path: remove any existing rendered block and return.
  // Accept both the boolean `false` and the string `"false"` — gray-matter
  // parses unquoted YAML `false` as boolean but quoted `"false"` as the
  // string "false", and both spellings look identical in a Markdown editor.
  // Strict equality on `=== false` would silently ignore the string form.
  if (
    parsed.data.claim_render === false ||
    parsed.data.claim_render === "false"
  ) {
    const cleaned = removeMarkerSection(raw, MARKER_NAME);
    if (cleaned !== raw) await fs.writeFile(args.skillMdPath, cleaned);
    return;
  }

  const limit =
    typeof parsed.data.claim_render_limit === "number"
      ? parsed.data.claim_render_limit
      : args.config.render_default_limit;

  const claims = await loadActiveMoveClaims(
    args.vaultPath,
    args.moveId,
    args.today,
    args.config,
  );

  // Cleanup path: zero qualifying claims → remove any prior render and exit.
  if (claims.length === 0) {
    const cleaned = removeMarkerSection(raw, MARKER_NAME);
    if (cleaned !== raw) await fs.writeFile(args.skillMdPath, cleaned);
    return;
  }

  const ranked = rankClaimsForDeployingProfile(
    claims,
    args.deployingProfileId,
    args.today,
    args.config,
  );
  const top = ranked.slice(0, limit);
  const bullets = top.map((c) => formatClaimBullet(c, args.today, args.config));
  const replacement = ["## Learned", "", ...bullets].join("\n");

  const next = renderBetweenMarkers(raw, MARKER_NAME, replacement, {
    renderedDate: args.today.toISOString().slice(0, 10),
    halfLifeDays: args.config.half_life_days,
  });

  if (next !== raw) await fs.writeFile(args.skillMdPath, next);
}
