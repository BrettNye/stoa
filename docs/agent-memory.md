# agent-memory: identity-keyed working context

Pull an agent's accumulated claims at decision time — decay-aware, scope-filtered, ranked. One MCP tool (`vault_agent-memory`) plus a complementary write surface (`vault_claim`). Together they close the feedback loop where an agent learns from its work and applies those learnings on subsequent dispatches.

This doc is for developers integrating with `@stoa-mcp/cli` who want to bake the agent-memory feedback loop into their workflow. It assumes stoa is installed and an MCP client is attached.

## What it is

The vault has three retrieval surfaces with distinct access patterns:

| Surface | Reader | Asks for |
|---|---|---|
| `vault_recall <topic>` | User in working session | "What does the vault know about X?" |
| `vault_agent-memory <agent_id>` | The agent itself, at decision time | "What have I LEARNED that's relevant to what I'm doing?" |
| `synthesis-{agent}-memory.md` | User asking about an agent | "What has this agent become?" (narrative, periodic refresh) |

`vault_agent-memory` is the **operational** retrieval: cheap to call, always fresh, structured output suitable for system-prompt injection.

## The data shape

A claim is a typed page at `wikis/<wiki>/claim/<id>.md`. Frontmatter includes:

- `key` — stable identity domain like `process.dag-planning.grep-symbol-consumers`.
- `confidence` — author's stated belief, `0..1`.
- `last_validated` — date; decay computes against this with 75-day half-life.
- `profile` — agents this claim is targeted at (e.g., `[charmander, pidgey]`). Empty `[]` = universal.
- `scope_wiki` — wikis this claim applies in. Empty `[]` = applies everywhere.
- `tags` — open vocabulary for matching.
- `authored_by` — `agent:<id>` | `human:<name>`.

The `_index/claims.json` sidecar (built by `vault_reindex`, currently `schema_version: 2`) inverts these into buckets — `by_authored_by`, `by_profile`, `by_scope_wiki`, `by_tag`, `global`. `vault_agent-memory` reads the sidecar fast-path; if absent or stale (`schema_version: 1` predates the `by_authored_by` bucket), falls back to a disk walk.

## Authoring (`vault_claim`)

```bash
vault claim --as agent:claude-code \
    --key process.dag-planning.grep-symbol-consumers \
    --title "DAG plans: grep for symbol consumers before assigning files: scope" \
    --body "When a DAG task introduces a contract change, its files: scope must include every test/consumer that asserts against the old contract..." \
    --profile '["claude-code"]' \
    --scope_wiki '["_meta"]' \
    --tags '["dag-planning", "cascade-prevention"]' \
    --confidence 0.85 \
    --evidence '["[[wikis/_meta/journal/journal-2026-05-13-1545-agent-memory-dag-shipped]]"]'
```

After authoring, run `vault_reindex` to populate the new claim into the sidecar buckets.

**Modifier flags:**
- `--revalidate` — bumps `last_validated` on an existing claim (resets decay).
- `--override true` — forces supersession on a same-identity-tuple conflict (otherwise the new claim is rejected if it's not at higher confidence than the existing).
- `--retract <id> --reason "..."` — marks an existing claim as `status: retracted`; excluded from all read paths.

**Prefix normalization (since 2026-05-13).** Profile values are stored bare — `agent:` and `profile-` prefixes are stripped on write so they match the bare-name convention `vault_agent-memory` uses for queries. Non-agent prefixes (e.g., `human:brett`) are preserved as-is.

## Retrieval (`vault_agent-memory`)

```bash
# Generic identity context — no specific task in mind.
vault agent-memory claude-code

# Task-scoped — tool derives wiki + tags from the task page.
vault agent-memory charmander --task task-engine-wire-dataprovider-into-services

# Explicit scope.
vault agent-memory pidgey --scope-wiki '["_meta"]' --tags '["voice","docs"]'

# Routing decision — many summaries, no bodies.
vault agent-memory pidgey --detail summary --limit 50

# System-prompt injection at session start.
vault agent-memory pidgey --token-budget 800
```

**Inclusion predicate:** A claim `C` is included for agent `A` with scope `S` iff:
- `C.scope_wiki` is empty OR intersects `S.scope_wiki` (the wiki AND-guard), AND
- One of: `C.authored_by == "agent:<A>"`, `C.profile contains <A>`, or `(C.profile is empty AND scope_match(C,S) > 0)`, AND
- `C.status == "active"`, AND
- `effective_confidence(C, today) >= 0.4`.

**Scope match:** `scope_match = jaccard(C.tags, S.tags) + jaccard(C.scope_wiki, S.scope_wiki) + (C.profile contains <A> ? 0.2 : 0)`.

**Score:** `score = effective_confidence × (1 + scope_match)`. Ranked descending; ties broken alphabetically by claim id.

**Response shape (abbreviated):**
```json
{
  "agent_id": "charmander",
  "scope_used": { "tags": [...], "scope_wiki": [...], "profile": ["charmander"] },
  "claims": [
    {
      "id": "claim-...",
      "key": "...",
      "summary": "first sentence of body",
      "body": "...",  // sized per `--detail`
      "effective_confidence": 0.85,
      "scope_match_score": 1.2,
      "score": 1.87,
      "authored_by": "agent:claude-code"
    }
  ],
  "total_pool_size": 1,
  "truncated": false
}
```

## Calibration: what scores mean

| `score` range | Interpretation |
|---|---|
| `< 0.4` | Filtered out as decay-floor (you shouldn't see these in results). |
| `0.4 – 1.0` | Weak relevance. Background context. |
| `1.0 – 1.5` | Standard relevance. Apply if obviously applicable. |
| `1.5 – 2.0` | Strong scope match. Body is load-bearing for the work. |
| `> 2.0` | Maximum-scope (perfect wiki + tags + profile-targeted). |

## Detail tiers

`--detail summary` returns metadata + the summary field only (~30 tokens/claim). Cheapest. Good for routing decisions.

`--detail truncated` (default) returns first ~200 chars of body + `(more...)` marker (~70 tokens/claim). Default for general use.

`--detail full` returns complete body, hard-capped at ~500 tokens per claim to prevent runaway. Use for deep prep.

Token budget enforcement uses a `chars/4` approximation per spec §3.3.7 — approximate, not byte-exact. Pass `--token-budget N` to pack claims by descending score until the next would exceed N.

## Error semantics

| Condition | Behavior |
|---|---|
| `agent_id` has no matching profile page | NOT an error. Returns empty result; `total_pool_size: 0`. |
| `--task <id>` doesn't exist | Soft warning, falls back to non-task scope. |
| `_index/claims.json` missing or stale | Disk-walk fallback (same as `vault_list-claims`). |

The tool is read-only and idempotent.

## The feedback loop

The substrate's value is compounding. The minimum pattern:

1. Agent claims a task → calls `vault_agent-memory --task <id>` → applies relevant claims during work.
2. On completion, if a non-obvious lesson surfaced → `vault_claim` it with appropriate `profile:` / `scope_wiki:` / `tags:`.
3. `vault_reindex` (manual or scheduled).
4. Next dispatch sees the new claim through its memory pull.

The cycle pays compound interest the longer it runs. Specialist agents aren't trained — they're *grown* through accumulated profile-targeted claims.

## Implementation references

- `src/tools/agent-memory.ts` — MCP tool surface (Zod schema, prefix normalization on `agent_id`).
- `src/core/agent-memory.ts` — ranking + filtering + scope derivation engine.
- `src/cli/commands/agent-memory.ts` — Commander CLI command.
- `src/types/claims-index.ts` — canonical `ClaimsIndex` interface (writer + reader share).
- `wikis/_meta/specs/2026-05-13-agent-memory-design.md` — protocol-level design spec (vault-resident).
- `wikis/_meta/guides/guide-agent-memory.md` — operational guide with worked examples (vault-resident).
