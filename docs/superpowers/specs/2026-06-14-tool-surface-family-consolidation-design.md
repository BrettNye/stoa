# Stoa tool-surface family consolidation — design

**Date:** 2026-06-14
**Status:** approved (brainstorming) → ready for implementation plan
**Implements:** lever #1 of [[wikis/_meta/decisions/decision-2026-06-08-stoa-tool-surface-consolidate-families-first]]
**Supersedes nothing; refines:** [[wikis/_meta/synthesis/synthesis-stoa-mcp-tool-surface-and-packaging]]

## Goal

Reduce the advertised MCP tool surface from **55 → 43 `vault_*` tools (−12)** by collapsing eight name-families into `mode`-parametrized tools. This is the cheap, transport-independent, principal-independent lever the governing decision puts **first**, because the dominant harm is now tool-**selection accuracy / audience mismatch** (which lazy-loading does not fix), not schema token cost.

The decision named four families (§1–§4). Brainstorming on 2026-06-14 added four more cohesive within-cluster families (§6) to push the surface lower. The stopping rule held throughout: consolidate a family only when it is **one cohesive cluster/noun with similar payloads**; do not merge unlike operations into a "god tool" (which relocates the selection problem into a conditional-field schema). The trainer lifecycle and the `profile-*` lifecycle were considered and **rejected** on that rule.

Non-goals (explicitly out of scope this pass):
- Splitting the server (rejected by the decision — one server stays).
- Per-principal capability-bundle filtering (decision lever #2 — conditional on a future measurement).
- Stadium cluster extraction (decision lever #3 — deferred until a second host forces it).
- Touching the CLI surface (`src/cli/commands/`). The CLI is independent of `allTools`; `stoa list-wikis` etc. stay as-is.

## Constraints carried from the codebase

- **Single dispatch source of truth.** `src/transport/stdio.ts` dispatches via `allTools.find(t => t.name === req.params.name)`. There is no separate name→handler map. Renaming the `name:` field + `allTools` membership is sufficient for dispatch; the `ListTools` advertisement derives from the same array.
- **No `z.discriminatedUnion`.** The MCP SDK rejects discriminated unions (documented gotcha on `merge-queue.ts` / `merge-record.ts` / `rewrite-links.ts`). All consolidated tools use a **flat** zod schema: a `mode` enum plus optional per-mode fields, validated at runtime in the handler.
- **Keep cluster file boundaries clean** (decision rule #4). No knowledge-tool file may import a Stadium-tool file. This constrains the `list` family consolidation (see §4).
- **Reuse `core/` delegates unchanged.** Only the tool wrapper (`name`, `inputSchema`, mode-routing) changes. The underlying `core/eventbus/*`, `core/merge-queue.ts`, `core/merge-record.ts`, `StadiumClient`, etc. keep their names and logic, so behavior is provably preserved.

## Migration posture

**Hard rename + version bump.** Old tool names are removed outright; only the consolidated tools are registered. All in-tree callers (tests, docs, CHANGELOG) are updated in the same change. No deprecation shims (they would temporarily *grow* the surface, working against the goal). Package is `0.x`; bump the minor (`0.1.0 → 0.2.0`) and mark the CHANGELOG entry **BREAKING** per semver-zero convention. Also bump the hardcoded `version: "0.1.0"` server string in `stdio.ts`.

## Consolidations

### 1. wait-for (4 → 1) — `vault_wait-for`

The strongest case: the four files are near-identical and all delegate to `handleWait(behavior, filters, since, timeout_ms, ctx)`.

```
vault_wait-for {
  mode: "next" | "any" | "all" | "many",
  filter?:  { source, wiki?, channel?, id? },        // next, many
  filters?: [ { source, wiki?, channel?, id? }, ... ],// any, all  (1..32)
  max?:     number,                                   // many only (1..1000)
  since?:   string,
  timeout_ms?: number  // default 25000, max 120000
}
```

| mode | was | filter source | behavior |
|---|---|---|---|
| `next` | `vault_wait-for` | `filter` (single) | `singleBehavior` |
| `any` | `vault_wait-for-any` | `filters[]` | `anyBehavior` |
| `all` | `vault_wait-for-all` | `filters[]` | `allBehavior` |
| `many` | `vault_wait-for-many` | `filter` + `max` | `makeManyBehavior(max)` |

Handler routing:
- `next`/`many` require `filter`; reject if `filters` is given or `filter` missing.
- `any`/`all` require `filters` (1..32); reject if `filter` is given or `filters` missing.
- `many` requires `max`; reject if absent. `max` ignored/ rejected for other modes.
- Normalize to the existing `handleWait(...)` call. `since` and `timeout_ms` are shared and unchanged.

`scope.axis` carries over: derive from `filter` (next/many) or `filters[0]` (any/all), preferring `channel` then `source`, default `*`. One `axis` function handles both shapes.

Delete `wait-for-any.ts`, `wait-for-all.ts`, `wait-for-many.ts`.

### 2. trainer-submit (2 → 1) — `vault_trainer-submit`

Within the Stadium cluster; same match-phase family, divergent payloads.

```
vault_trainer-submit {
  mode: "draft" | "move",
  match_id: string,              // shared (ULID for draft; min(1) for move)
  picks?:  string[],             // draft: exactly 6 ULIDs
  turn?:   number,               // move: int >= 0
  move_id?: string,              // move
  target?: string                // move (optional)
}
```

- `mode: draft` (was `-draft`): validate `match_id` ULID + `picks` length-6 ULIDs. Preserve `InvalidPicksShapeError` / `INVALID_PICKS_SHAPE` wrapping on shape failure. Call `StadiumClient.submitDraft`.
- `mode: move` (was `-move`): validate `match_id` + `turn` + `move_id` (+ optional `target`). Call `StadiumClient.submitMove`.
- Both: `resolveTrainerContext({})`, then echo `caller_trainer_id` onto the platform result; non-object response guards preserved per mode.
- `scope.axis` is identical for both (`matches/${match_id}`), carried over verbatim.

Delete `trainer-submit-draft.ts`, `trainer-submit-move.ts`.

### 3. merge (2 → 1) — `vault_merge`

Cross-operation (read vs write), same coordination cluster, so combining the file introduces no cross-cluster coupling. The tool description must state explicitly that `mode` switches between two unrelated operations.

```
vault_merge {
  mode: "queue" | "record",
  // queue (read):
  channel: string,               // shared (required in both modes)
  wiki?: string, family?: string, since?: string,
  // record (write):
  pr_number?: number,
  agent_id?: string,
  status?: "merged" | "failed" | "halted-conflict" | "halted-red-ci",
  merge_commit_sha?: string,
  notes?: string,
  task_id?: string
}
```

- `mode: queue` (was `vault_merge-queue`): pure read. Requires `channel`. Delegates to the existing `merge-queue` handler body (family resolution, `tailAcross`, disk-fallback journals, `buildMergeQueue`). Imports `core/merge-queue.ts`.
- `mode: record` (was `vault_merge-record`): write. Requires `pr_number`, `channel`, `agent_id`, `status`. Delegates to the existing `merge-record` handler body (alias resolution, journal compose+write, `upsertPage`, conditional task transition). Imports `core/merge-record.ts`. Preserves `UnknownAgentError` and the `__setNowFnForTests` seam.
- Handler validates required fields per mode and throws a clear error naming the missing field.
- `scope.axis`: both derive `wikis/${wiki ?? "*"}`; carried over.

Delete the **tool** files `merge-queue.ts` and `merge-record.ts` (the `core/` modules of the same name stay).

### 4. list (4 → 3) — within-cluster only

The four `list-*` tools span three clusters: `list-wikis` (knowledge/nav, has a CLI peer), `list-claims` (claims), `list-invites` + `list-platform-profiles` (Stadium). Merging all four into one `vault_list` would make that file import across knowledge + claims + Stadium, **violating decision rule #4 (keep cluster boundaries clean)**. So we consolidate **only within the Stadium cluster**:

```
vault_stadium-list { mode: "invites" | "platform-profiles", ... }
```

- `mode: invites` (was `vault_list-invites`): existing list-invites inputs/handler.
- `mode: platform-profiles` (was `vault_list-platform-profiles`): existing handler.

`vault_list-wikis` and `vault_list-claims` stay **standalone** — they have no in-cluster sibling to merge with, and merging across clusters would couple things the decision says to keep separable. Net for the family: 4 → 3 (−1).

Delete `list-invites.ts`, `list-platform-profiles.ts`; add `stadium-list.ts`.

## 5. Additional within-cluster families (added 2026-06-14)

### 5.1 task (4 → 1) — `vault_task`

The textbook mode-param case: CRUD on a single resource, all in the coordination cluster.

```
vault_task {
  mode: "create" | "list" | "update" | "claim",
  // create:
  title?: string, wiki?: string, description?: string, segregation?: string[],
  blocking?: string[], channel?: string, required_pokemon_type?: string,
  estimate_minutes?: number,
  // list:
  status?: enum, claimed_by?: string, pokemon_type?: string, limit?: number,
  // update:
  task_id?: string, expected_updated?: string, notes?: string,
  // claim:
  force?: boolean
  // (task_id/wiki/expected_updated shared by update+claim; status shared create-less)
}
```

- `mode: create` (was `vault_task-create`): `title` + `wiki` required. Delegates to `createTask` + `upsertPage`.
- `mode: list` (was `vault_task-list`): all-optional filters; alias-aware `claimed_by` expansion preserved.
- `mode: update` (was `vault_task-update`): `task_id` + `wiki` + `expected_updated` required; mtime OCC; `agent_id` stamped from `ctx.principal` (never a tool arg).
- `mode: claim` (was `vault_task-claim`): `task_id` + `expected_updated` required; preserves `TaskNotReadyError` → `TASK_NOT_READY` mapping; `agent_id` from principal.

**Mode-aware `scope.axis`** — the only structural wrinkle: `create`/`list` resolve `wikis/${wiki ?? "*"}`; `update`/`claim` resolve `tasks/${task_id}`. The axis function switches on `mode`. Handler validates required fields per mode.

Delete `task-create.ts`, `task-list.ts`, `task-update.ts`, `task-claim.ts`.

### 5.2 channel (2 → 1) — `vault_channel`

```
vault_channel {
  mode: "post" | "tail",
  channel: string,              // shared (kebab-case regex)
  content?: string,             // post
  session_id?: string,          // post
  since?: string, limit?: number,// tail
  wiki?: string                 // shared
}
```

- `mode: post` (was `vault_channel-post`): `channel` + `content` required; `agent_id` from principal; delegates to `postToChannel`.
- `mode: tail` (was `vault_channel-tail`): `channel` required; delegates to `tailChannel`.
- `scope.axis` identical for both: `channels/${channel}`.

Delete `channel-post.ts`, `channel-tail.ts`.

### 5.3 real-skill (2 → 1) — `vault_real-skill`

The cleanest merge of all: **identical** input schemas (`skill_id: /^move-/`, `wiki?`) and identical scope (`stadium`, `adminOnly`).

```
vault_real-skill { mode: "register" | "refresh", skill_id: string, wiki?: string }
```

- `mode: register` (was `-register`): reads `move-*/SKILL.md`, `StadiumClient.registerRealSkill`, persists `real_skill_id` + advisory `combat`.
- `mode: refresh` (was `-refresh`): requires existing `real_skill_id` (else the "register first" error), `StadiumClient.refreshRealSkill`, rewrites `combat`.

Delete `real-skill-register.ts`, `real-skill-refresh.ts`.

### 5.4 sync (2 → 1) — `vault_sync`

Both deploy a Pokémon's artifacts into a target repo; the v1.7 design already frames `sync-agents` as "the recommended primary surface" with `sync-skills` as the moveset-only fallback — i.e. conceptually one feature, two surfaces.

**Discriminator-name collision (important):** both tools already carry a field named `mode` (`"copy" | "symlink"`). The new discriminator therefore **must not** be called `mode`. Use **`surface: "skills" | "agents"`**, keeping each surface's existing `mode: copy|symlink` field intact.

```
vault_sync {
  surface: "skills" | "agents",
  // shared: target/repo_path, pokemon?, all?, exclude?, pokemon_type?,
  //         mode (copy|symlink), continue_on_error?, wiki?
  // skills-only: reverify?, fix?
  // agents-only: runtime?, overwrite?, include_moveset?
}
```

- `surface: skills` (was `vault_sync-skills`): full existing schema incl. `reverify`/`fix`/`all` deploy paths. Note `sync-skills` uses `repo_path`; `sync-agents` uses `target`. Normalize to one field name (`target`, alias `repo_path` in the handler) so the combined schema isn't doubled.
- `surface: agents` (was `vault_sync-agents`): full existing schema incl. `runtime`/`overwrite`/`include_moveset`.
- Both retain `scope { axis: "*", httpForbidden: true }`.

This is the heaviest of the eight (largest combined schema). It stays under the god-tool line because the two surfaces share most fields and the same verb ("deploy to repo"), but the spec flags it as the one to re-split first if the combined schema proves confusing in practice.

Delete `sync-skills.ts`, `sync-agents.ts` (keep `core/skills.ts`, `core/subagent-intent.ts`, adapters).

## Final surface

| Family | Before | After | Δ | Discriminator |
|---|---|---|---|---|
| wait-for | 4 | 1 | −3 | `mode: next\|any\|all\|many` |
| trainer-submit | 2 | 1 | −1 | `mode: draft\|move` |
| merge | 2 | 1 | −1 | `mode: queue\|record` |
| stadium list | 2 | 1 | −1 | `mode: invites\|platform-profiles` |
| task | 4 | 1 | −3 | `mode: create\|list\|update\|claim` |
| channel | 2 | 1 | −1 | `mode: post\|tail` |
| real-skill | 2 | 1 | −1 | `mode: register\|refresh` |
| sync | 2 | 1 | −1 | `surface: skills\|agents` |
| **total surface** | **55** | **43** | **−12** | |

## Error handling (all consolidated tools)

1. Invalid `mode` value → rejected by the zod enum.
2. Valid `mode`, missing/forbidden per-mode field → explicit `Error` naming the field (e.g. `vault_wait-for mode=any requires 'filters'`).
3. Existing domain errors preserved per mode: `InvalidPicksShapeError` (`trainer-submit draft`), `UnknownAgentError` (`merge record`).

## Testing strategy (TDD per tool)

For each consolidated tool, write tests **before** collapsing:
- One happy-path test per mode (asserting behavior matches the pre-consolidation tool — reuse existing assertions, just add the `mode` arg and rename the call).
- Mode↔field validation tests (wrong/missing fields per mode → named error).
- Update `tests/integration/tools-index.test.ts`: replace the four `vault_wait-for-*` name assertions with assertions on the consolidated names + absence of the old names.
- Update scope tests: `wait-for-scopes.test.ts`, `stadium-scopes.test.ts`, `read-tools-scope.test.ts`, `creator-scopes.test.ts` as the names move.
- Update `tests/e2e/mcp-client.test.ts`.
- Reuse `core/` delegates so the diff is provably behavior-preserving.

## Blast radius (in-tree callers to update)

- **Tool layer:** `src/tools/index.ts` (registry + comments), the rewritten/deleted tool files for all eight families.
- **Tests:** the per-tool unit + integration tests for all eight families, `tools-index.test.ts`, the scope tests (`wait-for-scopes`, `stadium-scopes`, `read-tools-scope`, `creator-scopes`), `e2e/mcp-client.test.ts`, plus the task/channel/sync/real-skill integration tests (e.g. `channel.test.ts`, `channel-tail-alias.test.ts`, `skills-sync.test.ts`, `draft-submit-happy-path.test.ts`, the task-coordination tests).
- **Docs:** `docs/tool-reference.md`, `docs/wait-for.md`, `README.md`, `CHANGELOG.md` (BREAKING), and mentions in `docs/claims.md`, `docs/task-coordination.md`, `docs/training-program.md`, `docs/quickstart.md`.
- **Version:** `package.json` minor bump + `stdio.ts` server-version string.

## Verification before done

- `grep` the repo for every old tool name (`vault_wait-for-any|-all|-many`, `vault_trainer-submit-draft|-move`, `vault_merge-queue|-record`, `vault_list-invites|-platform-profiles`, `vault_task-create|-list|-update|-claim`, `vault_channel-post|-tail`, `vault_real-skill-register|-refresh`, `vault_sync-skills|-agents`) outside CHANGELOG history.
- Note for follow-up (outside this repo): the parent Knowledge vault may carry slash-command skills / agent definitions that reference the old MCP tool names; those live in the private monorepo, not in `stoa`, and must be swept separately.
- Full test suite green; typecheck clean.

## What would make us revisit

- If a measurement later shows family consolidation did **not** improve selection accuracy (decision's invalidation clause), the merge/list portions are the first to reconsider — they were the weakest candidates.
- If schema token cost is measured material on a lazy-loading host, lever #2 (bundle filtering) reactivates — independent of this work.
