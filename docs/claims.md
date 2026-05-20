# Claims

A claim is the vault's unit of durable belief. Where a journal entry records what happened and a concept page defines a term, a claim says "I believe X" — with a confidence score, a scope, and a timestamp that decay audits against. Claims are the write surface for `vault_agent-memory`: when an agent calls that tool at decision time, it pulls its relevant active claims to use as working context.

This doc covers authoring, querying, decay, and lifecycle. For how claims are retrieved and ranked at dispatch time, see [`agent-memory.md`](./agent-memory.md).

## What a claim is

Claims live at `wikis/<wiki>/claim/<id>.md`. The file is a typed markdown page with structured frontmatter. Unlike a journal entry — which is ephemeral and append-only — a claim is meant to be superseded, revalidated, and queried across sessions. Unlike a concept page — which is reference material for readers — a claim is operational: it is pulled into context at decision time, not read by a human after the fact.

A claim is scoped along two dimensions simultaneously: `profile` names which agents it targets, and `scope_wiki` names which wikis it applies in. This dual scope is what makes the retrieval predicate precise. A claim with `profile: [charmander]` and `scope_wiki: [bedrock]` surfaces only when charmander is working in the bedrock wiki.

## Key fields

| Field | What it is |
|---|---|
| `key` | Stable identity string, dot-separated domain path (e.g. `process.dag-planning.grep-consumers`). Acts as the canonical name for a belief across supersessions — the new claim inherits the key, the old one is marked superseded. |
| `confidence` | Author's stated belief strength, 0..1 float. Default 0.7 if omitted. |
| `last_validated` | ISO date; decay computes against this with a 75-day half-life. |
| `profile` | Agent names this claim targets. Stored bare (no `agent:` prefix). Empty `[]` = universal. |
| `scope_wiki` | Wikis this claim applies in. Empty `[]` = global. |
| `authored_by` | `agent:<id>` or `human:<name>`. Only the original author may retract. |
| `tags` | Open vocabulary; used for scope matching and `vault_list-claims` filters. |
| `evidence` | Wikilinks to source pages — journal entries, task pages, course guides, PRs. |

## Authoring

The single tool `vault_claim` covers all four authoring actions: create, revalidate, supersede, and retract. The `--as` flag is required on every call — it sets both `authored_by` and the default for `profile` when no `--profile` is passed.

**Create a new claim:**

```
vault_claim
  as: "agent:claude-code"
  key: "process.dag-planning.grep-consumers"
  title: "DAG plans: grep for symbol consumers before assigning files scope"
  body: "When a DAG task introduces a contract change, its files: scope must include every test and consumer that asserts against the old contract. Missing these causes dependent-task breakage that only surfaces at integration time."
  profile: ["claude-code"]
  scope_wiki: ["_meta"]
  tags: ["dag-planning", "cascade-prevention"]
  confidence: 0.85
  evidence: ["[[wikis/_meta/journal/journal-2026-05-13-1545-dag-shipped]]"]
```

After authoring, run `vault_reindex` to populate the new claim into the sidecar buckets (`_index/claims.json`). Until you do, `vault_list-claims` falls back to a disk walk — correct but slower.

**Three modifier flags**, mutually exclusive:

- `revalidate: true` — bumps `last_validated` to today, resetting decay. Optionally also updates `confidence`. Use when you still believe the claim and want to extend its shelf life.
- `override: true` — forces supersession even if the new confidence is not strictly higher than the existing effective confidence. Needed when a decayed claim is blocking an update.
- `retract: "<claim-id>"` + `reason: "..."` — marks the claim `status: retracted`, excluded from all read paths. Only the original `authored_by` agent may retract. Retraction is the right action when you no longer believe the claim at all, as opposed to supersession (belief updated) or revalidation (belief confirmed).

When no modifier is passed and the same `key` + scope already has an active claim, the tool evaluates whether the new confidence exceeds the existing effective confidence. If it does, the existing claim is superseded automatically. If it does not, the write is rejected with a suggestion to either pass `override: true` or gather stronger evidence.

## Querying

`vault_list-claims` returns claims sorted by effective confidence descending. The default minimum effective confidence is 0.4 (the decay floor). The default limit is 10. All filters are optional and combinable.

**Filter by profile** — claims targeted at a specific agent:

```
vault_list-claims
  by: "profile"
  value: "charmander"
```

**Filter by tag:**

```
vault_list-claims
  by: "tag"
  value: "dag-planning"
```

**Filter by scope_wiki** — claims that apply in a specific wiki:

```
vault_list-claims
  by: "scope_wiki"
  value: "_meta"
```

**Filter by authored_by** — claims written by a specific author (pass the full `authored_by` value including prefix, e.g. `agent:claude-code`):

```
vault_list-claims
  by: "authored_by"
  value: "agent:claude-code"
```

**Global claims only** — claims with no profile, no move, and no scope_wiki:

```
vault_list-claims
  by: "global"
```

Add `min_effective_confidence: 0.7` to any of these to tighten the floor, or `status: ["superseded"]` to audit what has been displaced.

## Decay and revalidation

Effective confidence is not static. The formula applies a 75-day half-life against `last_validated`:

```
effective_confidence = stored_confidence * 2^(-days_since_validated / 75)
```

A claim authored at confidence 0.85 that has not been revalidated in 75 days has an effective confidence of about 0.43. At 150 days it is about 0.21, well below the 0.4 floor and filtered out of all retrieval paths.

This is intentional. Claims that nobody has checked on decay out of the agent's working context. The floor is not a bug — it is the vault's way of distinguishing actively-held beliefs from sediment.

The maintenance habit: weekly, run `vault_list-claims` with `min_effective_confidence: 0.5` and scan the results. Claims you still believe get `revalidate: true`. Claims that no longer hold get superseded or retracted. The revalidation call is cheap; a single touch resets the 75-day clock.

## Lifecycle

Claims follow a four-status path: `active` on creation, then one of three terminal states.

| Status | Meaning |
|---|---|
| `active` | The claim is held and surfaced by retrieval tools. |
| `superseded` | A newer claim with the same key has replaced this one. The page is kept for audit; read tools skip it. |
| `retracted` | The author explicitly discarded the belief. Kept for audit; excluded from all read paths. |

The practical rule: supersede when your view evolved (the new claim says something different); revalidate when nothing changed (you just want to reset the clock); retract when the belief was wrong or no longer relevant and you do not want to replace it.

Draft claims (status `draft`) are created by `vault_process-inbox` promotion but are not authored via `vault_claim` directly — the tool sets `status: active` on creation. If you want a claim visible to retrieval immediately, author via `vault_claim`.

## See also

- [`agent-memory.md`](./agent-memory.md) — retrieval mechanics: how claims are ranked, the inclusion predicate, detail tiers, and token-budget enforcement.
- [`training-program.md`](./training-program.md) — how curricular claims produced by courses seed cold-start context for fresh profiles.
- [`common-workflows.md`](./common-workflows.md) — task recipes for the broader vault workflow (recall, inbox, synthesis, task queue).
