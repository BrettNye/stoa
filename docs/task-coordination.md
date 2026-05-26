# Task coordination

Stoa exposes a small set of tools for distributing units of work across agents
or sessions. This page is the substrate contract: how task pages are shaped,
how the state machine works, and how concurrent claims are arbitrated. It does
not prescribe how any particular consumer should orchestrate work on top of it.

If you are looking for the unrelated **knowledge-claim** system (`vault_claim`
/ `vault_list-claims`), see the short distinction in
[`vault_claim` vs `vault_task-claim`](#vaultclaim-vs-vaulttask-claim) before
reading further.

## What a task is

A task is a Markdown page of `type: task`. Files live in
`wikis/<wiki>/tasks/<id>.md` and use the standard vault frontmatter contract
(see vault `CLAUDE.md`) plus task-specific fields. The id has the form
`task-<slug>`; the filename stem equals the id (see `src/core/tasks.ts:130-133`).

Minimum frontmatter as emitted by `createTask` (`src/core/tasks.ts:135-150`):

```yaml
---
id: task-<slug>
title: "..."
type: task
wiki: <wiki>
status: pending
created: YYYY-MM-DD
updated: YYYY-MM-DD
summary: "..."
# Optional, set by createTask when passed:
description: "..."
segregation: [path-glob, ...]
blocking: [task-id, ...]
channel: <name>
required_pokemon_type: <type>   # only this profile type may claim
estimate_minutes: <n>
# Added by claimTask:
claimed_by: agent:<id>
assigned_at: <iso-timestamp>
# Added by branch/merge tooling (not by core task lifecycle):
branch_suffix: <suffix>
---
```

The body is the agent-facing brief. For a task to be claimable without
`force: true` it must satisfy four readiness signals — see
[Readiness gate](#readiness-gate) below.

## State machine

Allowed `status:` values come from the Zod enum in
`src/tools/task-list.ts:7` and `src/tools/task-update.ts:10`:

```
pending → claimed → in_progress → completed
                                 ↘ failed
                                 ↘ blocked
```

| From | To | Performed by |
|---|---|---|
| (none) | `pending` | `vault_task-create` |
| `pending` | `claimed` | `vault_task-claim` |
| `claimed` | `in_progress` / `completed` / `failed` / `blocked` | `vault_task-update` |
| any | any (above set) | `vault_task-update` |

The core layer does **not** enforce direction. `updateTask`
(`src/core/tasks.ts:298-325`) accepts any status from the enum and writes it.
Consumers that need stricter transitions (e.g. forbidding `completed →
pending`) layer that on top.

There is no `abandoned` state. To release a claim, a consumer either
`vault_task-update` back to `pending` (clearing `claimed_by` is not exposed
through the tool — you would need to write the page directly), or sets
`status: failed` / `blocked`.

## Atomic claiming

`vault_task-claim` (`src/tools/task-claim.ts`, `src/core/tasks.ts:45-107`)
takes ownership of a pending task. Input shape:

```ts
{
  task_id: string;
  agent_id: string;          // bare id; the page records "agent:<id>"
  expected_updated: string;  // YYYY-MM-DD from a prior read of the page
  wiki?: string;             // resolved via _resolve-wiki when omitted
  force?: boolean;           // skip the readiness gate
}
```

Success returns:

```ts
{
  task_id: string;
  claimed_by: string;   // "agent:<id>"
  claimed_at: string;   // ISO timestamp written into assigned_at
  updated: string;      // new frontmatter date after the write
}
```

### Concurrency: lock-based mutual exclusion + staleness OCC

`claimTask` in `src/core/tasks.ts` is `async`. Callers must `await` it.

#### Per-task lock (mutual exclusion)

`claimTask` wraps its entire read-check-write sequence in
`withSerializedIndexWrite(vaultPath, [\`task-${input.task_id}\`], ...)` (see
`src/core/tasks.ts:47-111`). The lock key is `task-<id>` — one lock per task
page.

`withSerializedIndexWrite` in `src/core/index-locking.ts` uses `O_EXCL`
lockfiles with sorted-key acquisition and try/finally cleanup. Two concurrent
callers racing to claim the same task compete for the same lockfile; exactly
one acquires it, completes the full read-check-write inside, then releases.
The other caller then acquires the lock, reads the now-claimed page, and
throws `AlreadyClaimedError`.

Race scenario:

```
Agent A and Agent B both call claimTask(vaultPath, { task_id: "task-foo", ... })
concurrently.

  Agent A acquires lock "task-task-foo"
    A reads page → claimed_by undefined
    A passes readiness check
    A writes page → status: claimed, claimed_by: "agent:A"
  Agent A releases lock

  Agent B acquires lock "task-task-foo"
    B reads page → claimed_by: "agent:A"
    B throws AlreadyClaimedError { taskId: "task-foo", claimedBy: "agent:A" }
  Agent B releases lock

Result: exactly one winner. The loser sees AlreadyClaimedError with the
winner's identity in claimedBy.
```

Index sidecar locks (`pages.json`, etc.) acquired inside `writePage` use
distinct lock keys from `task-<id>`. Sorted-key acquisition prevents
deadlock.

#### Staleness OCC (frontmatter `updated:` date)

Inside the lock, `writePage` still checks the `updated:` frontmatter date
(`YYYY-MM-DD`) as a **staleness guard**: if the page's `updated:` has
advanced since the caller read it, `writePage` throws
`ConflictError(id, expectedUpdated, actualUpdated)`. This is no longer doing
the work of concurrency arbitration (the lock handles that); it catches the
case where you read the task yesterday and someone else updated it today
before you claimed it.

The tool description in `src/tools/task-claim.ts:16` and the CLI help text in
`src/cli/commands/task-update.ts:8` say "mtime OCC". The actual implementation
uses **the `updated:` frontmatter date** as the OCC token, not
`fs.stat().mtime`. See `writePage` in `src/core/pages.ts:102-116`:

> If the page on disk has a different `updated:` than the caller passed as
> `expectedUpdated`, `writePage` throws `ConflictError(id, expectedUpdated,
> actualUpdated)`.

To claim safely:

1. Read the task (e.g. via `vault_task-list` or by reading the file).
2. Capture `frontmatter.updated`.
3. Pass that value as `expected_updated`.

The actual filesystem-mtime OCC pattern *does* exist in stoa — but on
**knowledge claims**, not tasks. See `MtimeConflictError` in
`src/core/claims.ts:27-32`. The two systems share the OCC idea but not the
token.

### Race losers: `AlreadyClaimedError`

If `claimed_by` is already set on the page and does not match the requester,
`claimTask` throws (`src/core/tasks.ts:83-85`):

```ts
class AlreadyClaimedError extends Error {
  taskId: string;
  claimedBy: string;  // "agent:<winner-id>" — the actual recorded claimer
  // message: `task ${taskId} already claimed by ${claimedBy}`
  // name: "AlreadyClaimedError"
}
```

The losing caller sees the winner's identity in `claimedBy` and can act on it
(post to a channel, surface to a dispatcher, etc.). Re-claiming by the same
agent id is a no-op success — the equality check at
`src/core/tasks.ts:83` only throws when the existing claimer differs from the
requester.

### Order of failure modes

`claimTask` checks gates in this order (see comments at
`src/core/tasks.ts:51-85`):

1. `WrongTypeError` — task has `required_pokemon_type` and the agent's profile
   `pokemon_type` / `secondary_pokemon_type` does not match. Profile read is
   tolerant: a missing profile defaults the agent type to `"normal"`.
2. `TaskNotReadyError` — readiness gate (unless `force: true`).
3. `AlreadyClaimedError` — someone else holds it.

The MCP wrapper (`src/tools/task-claim.ts:23-30`) translates
`TaskNotReadyError` to a plain `Error` decorated with
`{ code: "TASK_NOT_READY", missing: TaskReadinessSignal[], task_id }`. The
other two errors propagate unchanged.

### Readiness gate

`checkTaskReadiness` (`src/core/task-readiness.ts:40-47`) requires four loose
signals to be present somewhere in the body:

| Signal | Matched by |
|---|---|
| `files` | A `path.ext` substring with one of ~16 extensions, optionally `:N` or `:N-M` |
| `scope` | `## Scope`/`## Implementation`/`## Approach`/`## Diagnose`/`## Requirements` heading, or a `**Scope:**`-style bold marker, or `scope:` / `requirements:` line start |
| `out_of_scope` | `## Out of scope`, `**Out of scope:**`, or the inline phrase "out of scope" |
| `verification` | `## Verification`/`## Acceptance criteria`/`## Done means`/`## Done when`, or the bold equivalents |

All matches are case-insensitive. When any signal is missing the call throws
`TaskNotReadyError(taskId, missing)` carrying the array of missing signal
names. Passing `force: true` bypasses the gate entirely.

## Tool surface

All tools are wired in `src/tools/`; the CLI shims live in
`src/cli/commands/`. The CLI is largely 1:1 with the MCP tools, with one
exception called out below.

### `vault_task-create`

Source: `src/tools/task-create.ts`, core `createTask`
(`src/core/tasks.ts:130-170`).

Creates a new page in `wikis/<wiki>/tasks/`, `status: pending`. The id is
derived from the title via `slugify` and is truncated to 60 chars
(`src/core/tasks.ts:126-128`). After write, the tool calls `upsertPage` so the
new task is visible to index-backed tools without a manual reindex.

Inputs of note: `title` (required), `wiki` (required), optional `description`,
`segregation`, `blocking`, `channel`, `required_pokemon_type`,
`estimate_minutes`.

Output: `{ id, path, updated }`.

If `description` is omitted, the body is seeded with a template stubbing
Scope / Out of scope / Verification (`src/core/tasks.ts:155-167`) — which is
deliberately enough to satisfy the readiness gate's `scope` / `out_of_scope` /
`verification` signals but not `files`. A newly created task with no
description is **not** claimable without grooming or `force: true`.

### `vault_task-list`

Source: `src/tools/task-list.ts`, core `listTasks`
(`src/core/tasks.ts:198-239`).

Reads `wikis/*/tasks/*.md` directly from disk and filters in-process. Filters:
`wiki`, `status`, `claimed_by`, `channel`, `pokemon_type`, `limit` (default
50). Malformed files are silently skipped.

`claimed_by` is **alias-aware** (`src/tools/task-list.ts:20-35`): a query for
`agent:<current-id>` will surface tasks that were claimed under any historical
id of the same agent profile, by expanding through the alias index.

Output shape per task is `TaskSummary` (`src/core/tasks.ts:181-196`):
`{ id, title, status, claimed_by?, pokemon_type?, segregation?, blocking?,
channel?, wiki, branch_suffix? }`.

### `vault_task-claim`

Source: `src/tools/task-claim.ts`, core `claimTask`
(`src/core/tasks.ts:45-107`). See [Atomic claiming](#atomic-claiming) above
for the full contract — the rest of this entry is a pointer.

CLI shim (`src/cli/commands/claim-task.ts`) reads the task first to obtain
`expected_updated`, so users do not have to pass it. The MCP tool requires the
caller to pass it explicitly. **There is no `task-claim` subcommand on the
CLI; the command is `claim-task`** (note the dash order). This is the one
CLI/MCP naming asymmetry in the surface.

### `vault_task-update`

Source: `src/tools/task-update.ts`, core `updateTask`
(`src/core/tasks.ts:298-325`).

Patches `status`, `segregation`, and/or appends a `## <iso-timestamp> —
<agent_id>` notes section to the body. Also write-through to the index. Uses
the same `expected_updated` OCC as claim — pass the `updated:` you last saw,
or you will get `ConflictError`.

Does not touch `claimed_by` or `assigned_at`. To re-assign a task, write the
page directly.

## `vault_claim` vs `vault_task-claim`

These are different systems with deceptively similar names.

| | `vault_task-claim` | `vault_claim` |
|---|---|---|
| About | Taking ownership of a unit of work | Recording an evidence-backed assertion |
| Operates on | A `type: task` page | A `type: claim` page |
| Stored in | `wikis/<wiki>/tasks/` | `wikis/<wiki>/claim/` |
| Core module | `src/core/tasks.ts` | `src/core/claims.ts` |
| Concurrency | per-task `O_EXCL` lockfile (mutual exclusion) + `expected_updated` staleness OCC | `expectedMtime` (real `fs.stat().mtime`, ISO) |
| Race-loss error | `AlreadyClaimedError` | `MtimeConflictError` |
| Sibling tools | `vault_task-create`, `vault_task-list`, `vault_task-update` | `vault_list-claims` |

The `vault_claim` tool (`src/tools/claim.ts`) is a single primitive over four
authoring actions on the knowledge-claim store: create, revalidate, supersede,
retract — plus a `rejected` no-write response when override confidence is too
low. It also has a `retract` path with author-only authorization
(`src/tools/claim.ts:331-363`) — only the original `authored_by` may retract.

Nothing in `vault_claim` operates on task pages and nothing in
`vault_task-claim` operates on claim pages. If a function call mentions one,
the other is not involved.

## Failure modes consumers should handle

**Race loss on claim.** Catch `AlreadyClaimedError`. The `claimedBy` property
names the winner. Re-claim attempts by the same agent id are idempotent
(silent success), so a retry after a partial-write surprise is safe.

**Stale `expected_updated`.** If the page's `updated:` advances between your
read and your write, `writePage` throws `ConflictError(id, expectedUpdated,
actualUpdated)` (`src/core/pages.ts:14-22`). Re-read, reconcile, retry. The
`updated:` OCC is a staleness guard (day-resolution), not the concurrency
mechanism — the per-task lock (`withSerializedIndexWrite`) provides mutual
exclusion for same-day concurrent writes.

**Readiness rejection.** `TaskNotReadyError` (or, at the MCP boundary, an
error with `code: "TASK_NOT_READY"` and a `missing` array) means the body is
missing one or more of the four signals. Either edit the body to add what is
missing or re-call with `force: true`.

**Wrong-type rejection.** A `required_pokemon_type` on the task that the
caller's profile does not match throws `WrongTypeError`
(`src/core/tasks.ts:16-21`) with message prefix `WRONG_TYPE`. The agent's
profile is looked up at `profile-<agent_id>`; if no profile exists the type
defaults to `"normal"`, which only matches a task that explicitly requires
`normal`.

**Task renamed mid-claim.** `readPage` is id-keyed and scans a fixed list of
type folders (`src/core/pages.ts:59-74`). If the file was renamed between
your `task-list` and your `task-claim`, the claim throws `PageNotFoundError`.
There is no rename atomicity story at the substrate level; consumers that
rename task files should treat in-flight claims as invalidated.

**Disk-fallback for fresh tasks.** Some downstream tools (e.g.
`vault_merge-record`) read `_index/pages.json` first and fall back to a
targeted disk scan via `findTaskOnDisk` (`src/core/tasks.ts:270-280`). Both
`task-create` and `task-update` do write-through index updates, so the
fallback is rarely needed — but if you bypass the tools and edit task files
directly, run `vault_reindex` before tools that read from the index.
