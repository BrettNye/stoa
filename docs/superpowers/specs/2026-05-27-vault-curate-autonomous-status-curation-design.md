# `vault_curate` — Autonomous Status Curation

**Status:** design
**Date:** 2026-05-27
**Author:** Brett (with Claude)
**Supersedes consideration:** partially addresses `idea-planspec-status-hygiene-gap-landed-work`; relaxes Behavioral Contract #5.

---

## 1. Problem

Every page in the vault is born `status: draft`. Behavioral Contract #5 (`CLAUDE.md`) states: *"Agents do not self-promote; humans review and promote."* In practice the human does not review every file, so pages accumulate at `draft` indefinitely — including work that has demonstrably shipped.

The canonical example, already diagnosed in `idea-planspec-status-hygiene-gap-landed-work`: PR #14 (claims-foundation) merged on 2026-05-02 and shipped a whole subsystem, but `spec-vault-mcp-claims-design` and its three execution plans still carry `status: draft`. `vault_recall` surfaces them as drafts, which actively misleads — the AI described built work as "specced but not built."

A partial mitigation already ships (the `MISSING_CURATION_PRIORITY` lint + `curation_priority` field), but its stance is still "the human triages by reading priority annotations." That is the exact bottleneck this design removes.

**Goal:** let the AI move pages along the status lifecycle autonomously, on checkable evidence, with every action recorded and reversible — so the draft pile reflects reality without requiring per-file human review.

## 2. Decisions locked during brainstorming

| Question | Decision |
|---|---|
| Trust model | **Full autonomy + audit.** The AI applies status changes without pre-approval; the human audits after the fact. |
| Audit surface | **Digest journal entry.** One journal page per curation run; reversible via git; surfaced by recall + dashboard channel pane. |
| Actions owned | **All four:** promote landed work → `accepted`, promote draft → `active`, archive stale/dead drafts, resolve & supersede. |
| Scope | **All pages, gentler on human-authored.** Agent-authored drafts get the full treatment; human-authored pages are promoted on evidence but **never auto-archived** — only flagged. |
| Trigger | **Tool + session-start nudge.** A `vault_curate` MCP tool (and `stoa curate` CLI) the AI invokes; `vault_start`/`vault_orient` nudge when draft debt exists. No background process. |
| Build shape | **Dedicated tool + rule registry** mirroring `src/core/lint-checks/`. Lint stays read-only. |
| `accepted` when fields missing | **Downgrade to `active`, flag the gap.** Never mint malformed canon. |
| Archive mechanism | **In place** — set `status: archived` + `archived_at`; no physical move to `_archive/` in v1. |

## 3. Status lifecycle reference

`draft → active → accepted → superseded / archived`; `question`: `open → resolved`.

| Status | Required fields (cumulative) | Meaning |
|---|---|---|
| `draft` | `id`, `type`, `title`, `created` | Minimal capture. |
| `active` | + `wiki`, `status`, `summary`, `updated` | Relied on; recall surfaces it confidently. |
| `accepted` | + `tags`, `related` (decisions: + `confidence`; superseding spec/decision: + `supersedes`) | Canonical; other pages may safely cite it. |
| `superseded` / `archived` | + `superseded_by` or `archived_at` | Lifecycle terminus; surfaced only via lineage walks. |

The `active` vs `accepted` distinction is load-bearing for this design: a merged PR proves work *shipped* (justifies `active`) but does not prove the page is clean, citeable canon (`accepted`). See §5.1.

## 4. Architecture

### 4.1 Curation-rule registry — `src/core/curation-rules/`

Mirrors the existing `src/core/lint-checks/` registry. A module-level `registerCurationRule({ code, run })`; each rule's `run(ctx, idx, input)` returns `CurationAction[]`. Rules are pure over their inputs (index + per-page frontmatter + injected git/PR signal lookups), so each is unit-testable in isolation.

```ts
type Confidence = "high" | "medium" | "low";

interface CurationAction {
  code: string;            // "PROMOTE_LANDED" | "PROMOTE_ACTIVE" | "ARCHIVE_STALE" | "RESOLVE_SUPERSEDE"
  page_id: string;
  wiki: string;
  from_status: string;
  to_status: string;       // "active" | "accepted" | "archived" | "superseded" | "resolved"
  evidence: string;        // human-readable, e.g. "PR #14 merged at 669ff7c"
  confidence: Confidence;
  author_class: "agent" | "human"; // parsed from `author:` frontmatter; absent → "human"
  field_patch?: Record<string, unknown>; // extra frontmatter (archived_at, superseded_by, related, …)
  applies: boolean;        // set by the gate (§4.3), never by the rule itself
  flag_reason?: string;    // set when applies=false, explains why it was held back
}

interface CurationRule {
  code: string;
  run(ctx: CurationCtx, idx: VaultIndex, input: CurateInput): CurationAction[];
}
```

`CurationCtx` carries `vaultPath`, `today`, the resolved `principal.agent_id`, config (§4.5), and a `verifyPrMerged(ref)` callback (injectable for tests; backed by `gh pr view --json state` / merge-commit presence in production, and a no-op returning `unknown` in HTTP mode — see §4.6).

### 4.2 The four rules

**PROMOTE_LANDED → `accepted` (or `active`).**
Candidates: `plan` or `spec` pages at `draft`/`active`.
- **High confidence** if the page's `implementation:` block references a PR and `verifyPrMerged` confirms it merged.
- **Medium confidence** if no PR link but every `related:` task page is `status: done`/`completed`.
- Target resolution: if the page satisfies (or the rule can fill) the `accepted` tier — `tags` present, `related` present or derivable from inbound links, and for `decision` a `confidence` already set — emit `to_status: "accepted"`. **Otherwise downgrade to `to_status: "active"`** and set `flag_reason: "eligible for accepted — needs <missing fields>"`. The rule never fabricates `tags` or a decision `confidence` to force `accepted`.
- Unverifiable PR evidence (no `gh`, network failure, ambiguous state) → degrade to medium/flag; **never promote on unverifiable evidence.**

**PROMOTE_ACTIVE → `active`.**
Candidates: `draft` pages.
- Signal: ≥1 inbound link in `_index/links.json`, **or** `updated`/mtime within `config.promote_active_recent_days` (default 14).
- Requires `summary` present for the `active` tier. If missing → `applies=false`, `flag_reason: "draft → active blocked: add summary"`. The rule does **not** fabricate a summary.

**ARCHIVE_STALE → `archived`.**
Candidates: `draft` pages.
- Signal: untouched (`updated`/mtime) ≥ `config.archive_stale_days` (default 60) **and** zero inbound links **and** not referenced in any journal within the staleness window.
- `field_patch: { archived_at: <today> }`. Sets `status: archived` in place; the file does not move. Recall already filters `include_archive: false`, so archived pages drop from default search while remaining on disk and in git.

**RESOLVE_SUPERSEDE.** Explicit-link signals only:
- **Supersede:** if some page Y carries `supersedes: [[X]]` (resolved via `_index/links.json`) but X's status is not `superseded` → emit X `to_status: "superseded"`, `field_patch: { superseded_by: "[[…Y]]" }`. High confidence (explicit authored link).
- **Resolve:** if a `question` page has an explicit `resolved_by:` link but status ≠ `resolved` → emit `to_status: "resolved"`. High confidence.
- **Out of scope:** fuzzy "a decision probably answers this question" inference. That depends on the `resolution:` block defined in the *active* `spec-resolution-lifecycle-design` and is deferred to that work — this rule only acts on links that already exist in frontmatter.

### 4.3 The gate — `gateActions(actions, config): CurationAction[]`

Pure function that sets `applies` and `flag_reason`:

1. **Confidence floor.** Apply `high` and `medium` by default; `low` is never auto-applied (always flagged). Floor is configurable via `config.confidence_floor`.
2. **Scope.** If `to_status === "archived"` and `author_class === "human"` → `applies = false`, `flag_reason: "archive candidate — human-authored, your call"`. (Governed by `config.auto_archive_human`, default `false`.) All other moves on human-authored pages — i.e. evidence-based promotions — are permitted. Agent-authored pages get the full treatment.
3. **Contract satisfiability.** If the target tier requires fields the rule could neither find nor fill → `applies = false` with the gap named (this is where PROMOTE_LANDED's downgrade and PROMOTE_ACTIVE's missing-summary land if not already resolved upstream).

The gate is the single chokepoint where policy lives; rules only describe *what could change* and *why*, the gate decides *whether it's allowed*.

### 4.4 The tool — `vault_curate` (+ `stoa curate` CLI)

**Input (Zod):** `{ wiki?: string; dry_run?: boolean; confidence_floor?: Confidence; since?: string }`. `dry_run` defaults to `false` (full autonomy). Per server-mode convention, the tool stamps `agent_id` from the verified principal; it is not accepted as input.

**Flow:**
1. Load the index; collect candidate pages (`status` ∈ {`draft`, `active`} and `question` `open`), scoped by `wiki` if given.
2. Run every registered curation rule → flat `CurationAction[]`.
3. `gateActions` → set `applies`.
4. For each `applies: true`: patch frontmatter via `upsertPage` — set `status` (or `question` resolution), merge `field_patch`, bump `updated` to today. (Using `upsertPage` keeps `pages.json`/`tokens.json`/`wikis.json` write-through consistent.)
5. Write exactly **one** digest journal page `journal-YYYY-MM-DD-HHMM-curation-run.md` in the active wiki's `journal/` (or `_meta` when corpus-wide): grouped applied actions with evidence, plus a "Flagged — not applied" section listing held-back candidates with `flag_reason`. `author: agent:<principal>`, `session_id` set.
6. If `config.auto_commit` (default `true`) **and** stdio mode: `git add` the changed pages + journal and commit `chore(curate): promote N, archive M, resolve K — see <journal-id>`.

**Output:** `{ applied: CurationAction[]; flagged: CurationAction[]; journal_id: string }`.

**Idempotency (Contract #6):** a page already at its target status produces no action; a second run immediately after a first is a no-op (empty `applied`).

### 4.5 Config — `.stoa/config.json`

New optional block:

```json
"curation": {
  "archive_stale_days": 60,
  "promote_active_recent_days": 14,
  "confidence_floor": "medium",
  "auto_archive_human": false,
  "auto_commit": true
}
```

Missing block → all defaults (which encode the brainstorm decisions). Partial config merges over defaults at the key level, consistent with existing `.stoa/config.json` handling.

### 4.6 Server mode

`vault_curate` performs corpus-wide writes and is therefore **admin-shaped**: it requires `admin:*` (or `admin:vault_curate`) over HTTP and is unrestricted over stdio, matching `vault_reindex` / `vault_set-active` / `vault_evolve-profile`. In HTTP mode, `auto_commit` is forced off and `verifyPrMerged` returns `unknown` (no local `gh`/git assumed) — the tool writes files and the digest journal; the operator's deployment owns VCS. It is *not* HTTP-forbidden — unlike the substrate-scaffolding tools, curating status is a legitimate networked operation.

### 4.7 Session-start nudge

`vault_start` and `vault_orient` run the rule registry in **count-only** mode (rules + gate, no writes) and include a `curatable_count` plus a short line: *"N pages have promotion/archive evidence — run vault_curate to clean up."* This keeps curation inside the model's control loop (the chosen trigger) without a background process and without auto-running.

## 5. Rationale & trade-offs

### 5.1 Why `active` is the honest ceiling for PROMOTE_LANDED

`accepted` means "canonical; other pages may safely cite it" and requires `tags` + `related` (+ `confidence` for decisions). A merged PR is strong evidence the work is *real and in use* (`active`) but only partial evidence that the page is clean, well-tagged canon. Forcing `accepted` would either violate the frontmatter contract or stamp canon onto machine-guessed metadata. Downgrading to `active` and flagging the gap keeps every auto-applied claim fully backed by evidence, and leaves ratification to `accepted` as a deliberate human (or later-pass) step.

### 5.2 Why a dedicated registry rather than extending lint

Behavioral Contract #7: *"`/lint` suggests; user disposes — never auto-apply."* Lint is read-only by contract. Routing write-intent through lint diagnostics would couple detection to action and erode that boundary. A separate `curation-rules/` registry gives curation its own explicit write authority in one place, while reusing lint's proven, testable registry *shape*.

### 5.3 Why in-place archive (no `_archive/` move) in v1

Setting `status: archived` already removes a page from default recall. A physical move to `_archive/` adds link-rewriting and path-stability concerns for marginal benefit. Deferred; revisit if the archived set grows large enough to clutter wiki folders.

### 5.4 Behavioral Contract #5 amendment

This design changes vault canon. `CLAUDE.md` §"Behavioral contracts" #5 currently reads: *"Agents do not self-promote; humans review and promote."* It will be amended to:

> **5. Agent attribution contract.** Agent-authored pages carry `author: agent:<id>` and start as `status: draft`. Agents do not self-promote *ad hoc* during authoring. However, `vault_curate` may advance page status autonomously on checkable evidence — promotion on merged-PR / all-tasks-done / inbound-link signals, archival of stale agent-authored drafts, and link-based resolve/supersede. Every curation action is recorded in a digest journal and is reversible via git. Human-authored pages are never auto-archived; they are flagged for the owner's disposal. `accepted` remains reachable only when the frontmatter contract for that tier is satisfied.

The spec self-review and user-review gate (below) must explicitly confirm this amendment before implementation.

## 6. Testing strategy

- **Per-rule unit tests** over fixture pages: PROMOTE_LANDED (merged PR → accepted; merged PR but missing tags → active+flag; tasks-all-done → medium; unverifiable PR → flag), PROMOTE_ACTIVE (inbound link → active; missing summary → flag), ARCHIVE_STALE (stale+no-links → archive; stale but linked → no action; recent → no action), RESOLVE_SUPERSEDE (supersedes link → superseded; resolved_by link → resolved).
- **Gate unit tests:** confidence × author_class × target-tier matrix, including the human-archive hold-back and the `auto_archive_human` override.
- **Integration test** against `tests/fixtures/test-vault`: seed a merged-PR plan, a stale orphan draft, a superseded chain, and a human-authored stale draft; run `vault_curate`; assert correct transitions, the digest journal exists with both applied and flagged sections, human draft was flagged not archived, and a **second run is a no-op**.
- **Server-mode test:** HTTP call without `admin:*` raises `ScopeDeniedError`; HTTP call with `admin:*` writes files but performs no git commit.

## 7. Error handling

- Missing `gh`/git or network failure during PR verification → `verifyPrMerged` returns `unknown` → PROMOTE_LANDED degrades to flag; never guesses.
- Malformed frontmatter on a candidate → skip the page (format lint owns it).
- Per-page `upsertPage` failure → continue with remaining pages; record the failure in the digest's flagged section.
- Empty result (nothing eligible) → still returns cleanly with empty `applied`/`flagged`; writes no journal and makes no commit.

## 8. Out of scope (this spec)

- Fuzzy question→decision resolution inference (depends on `spec-resolution-lifecycle-design`).
- Physical `_archive/` relocation.
- Scheduled/cron execution (the on-demand tool + session-start nudge is the chosen trigger; a cron wrapper around `stoa curate` is trivially addable later but not specified here).
- Dashboard "recently auto-curated" pane with one-click revert (the digest journal is the chosen audit surface; the dashboard pane was the runner-up and can layer on later).
- Auto-promotion of `synthesis`/`concept`/`guide` pages on edit-recency alone — the four rules target the high-signal cases first.

## 9. Open items for plan phase

- Exact `implementation:` → PR-number parse (the frontmatter `implementation:` block carries `pr: github.com/<owner>/<name>/pull/N`; confirm the shape across existing pages before writing the parser).
- Whether the corpus-wide digest journal lands in `_meta/journal/` or the resolved active wiki when `wiki:` is omitted (lean `_meta`).
- Inbound-link freshness: `links.json` write-through is partial (deferred from v1.7 §12.1); confirm the inbound-edge data ARCHIVE_STALE/PROMOTE_ACTIVE rely on is fresh enough, or force a scoped reindex at the top of a curate run.
