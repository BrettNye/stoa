# Tool reference

Alphabetical reference for every MCP tool exposed by stoa. All tools are registered under the `vault_*` namespace and dispatched via the stdio transport (or, in tests, the shared `callTool` harness). Tools requiring a wiki accept an optional `wiki:` field; resolution order is **explicit arg → `--default-wiki` MCP flag → `.active-wiki` file → error** (see `src/tools/_resolve-wiki.ts`). Stadium tools instead use `resolveTrainerContext` (see `src/core/resolve-trainer-context.ts`): **explicit trainer arg → `STADIUM_TRAINER` env → `~/.vault/stadium.toml` `active=` → error**.

Groups: [Core](#core) · [Coordination](#coordination) · [Tasks](#tasks) · [Claims](#claims) · [Agent substrate](#agent-substrate) · [Sync primitives](#sync-primitives) · [Stadium](#stadium) · [Misc](#misc).

---

## Core

### vault_inbox

Drop a fleeting thought into the resolved wiki's `inbox/` as a datestamped untyped file.

**Params:**
- `thought` (string, required, min 1): The content to capture.
- `wiki` (string, optional): Wiki to write into; falls back to resolution chain.

**Returns:** `{ id, path }` for the new inbox file.

**Errors:** `WikiRequiredError` when the wiki cannot be resolved.

**Example:**
```json
{ "tool": "vault_inbox", "args": { "thought": "consider replacing token index with sqlite FTS5" } }
```

**Source:** `src/tools/inbox.ts`

---

### vault_lint

Read-only health check; emits diagnostics for the resolved wiki (or vault-wide when omitted) at or above the requested severity.

**Params:**
- `wiki` (string, optional): Restrict diagnostics to one wiki.
- `level` (`"error" | "warning" | "info"`, default `"warning"`): Minimum severity returned.

**Returns:** `{ diagnostics: [...], summary: { errors, warnings, info } }`. Each diagnostic carries `code`, `severity`, `message`, and a page reference.

**Errors:** None routine; malformed pages are skipped, not thrown.

**Example:**
```json
{ "tool": "vault_lint", "args": { "wiki": "_meta", "level": "warning" } }
```

**Source:** `src/tools/lint.ts`

---

### vault_list-wikis

List visible wikis with per-wiki page counts, optionally grouped by family.

**Params:**
- `include_reserved` (boolean, default `false`): Include reserved wikis (`_archive`, etc.); `_agents` is always included.
- `family` (string, optional): Filter to wikis whose `family` matches.
- `group_by_family` (boolean, default `false`): Switch return shape to `{ families, unfamilied }`.

**Returns:** `{ wikis: WikiSummary[] }` by default; `{ families, unfamilied }` when `group_by_family: true`. Indexed counts are augmented with on-disk pages absent from `_index/pages.json` (v1.7 §5.4).

**Errors:** None.

**Example:**
```json
{ "tool": "vault_list-wikis", "args": { "group_by_family": true } }
```

**Source:** `src/tools/list-wikis.ts`

---

### vault_new

Create a typed page from the template; auto-generates `id`, writes frontmatter, and write-through-upserts the page into `_index/pages.json`.

**Params:**
- `type` (NoteType enum, required): One of `concept | spec | decision | synthesis | guide | source | idea | question | task | journal | map | profile | move`.
- `wiki` (string, required): Destination wiki (no resolution fallback).
- `title` (string, required, min 1): Human title.
- `frontmatter` (record, optional): Extra frontmatter fields merged over the auto-filled defaults.
- `body` (string, optional): Body content; defaults to `# <title>\n\n`.
- `status` (PageStatus enum, default `"draft"`): Initial status.

**Returns:** `{ id, path, ... }` from `writePage`.

**Errors:** Zod validation errors on bad enums; filesystem errors on write.

**Example:**
```json
{ "tool": "vault_new", "args": { "type": "guide", "wiki": "_meta", "title": "Onboarding ritual" } }
```

**Source:** `src/tools/new.ts`

---

### vault_new-wiki

Scaffold a new wiki: directory tree, starter `map.md` / `log.md` / `CLAUDE.md`, REGISTRY entry.

**Params:**
- `name` (string, required, regex `^[a-z0-9]+(-[a-z0-9]+)*$`): Wiki slug.
- `mode` (`"idea-map" | "project-doc" | "learning" | "mixed"`, required): Posture.
- `scope` (string, required, min 1): Single-line description of what the wiki covers.
- `family` (string, optional): Family group; surfaced by reindex.

**Returns:** `{ path, files_written, ... }` from `newWiki`.

**Errors:** Zod regex failures on `name`; throws if the wiki already exists.

**Example:**
```json
{ "tool": "vault_new-wiki", "args": { "name": "cooking", "mode": "learning", "scope": "Recipes and technique notes." } }
```

**Source:** `src/tools/new-wiki.ts`

---

### vault_process-inbox

Two-phase promotion of `inbox/` items. Phase 1 (`commit: false`) returns proposals; phase 2 (`commit: true`) moves files and writes frontmatter.

**Params:**
- `wiki` (string, optional): Wiki whose inbox to process.
- `commit` (boolean, default `false`): Apply proposals if true.
- `item_id` (string, optional): Reserved for single-item processing.
- `items` (array of `{ inbox_path, type, id, title? }`, optional): Required when `commit: true`.

**Returns:** `{ proposals: [...] }` in phase 1; `{ promoted: [...], log_entries_written }` in phase 2.

**Errors:** `commit=true requires items[]` if items omitted.

**Example:**
```json
{ "tool": "vault_process-inbox", "args": { "wiki": "_meta", "commit": false } }
```

**Source:** `src/tools/process-inbox.ts`

---

### vault_read

Read a page by id; returns frontmatter, body, and the `updated` handle for follow-up OCC writes.

**Params:**
- `id` (string, required): Page id (filename stem).
- `wiki` (string, optional): Wiki to look up the page in.

**Returns:** `{ frontmatter, body, updated, path }`.

**Errors:** Filesystem errors propagate; `WikiRequiredError` if wiki cannot be resolved.

**Example:**
```json
{ "tool": "vault_read", "args": { "id": "guide-vault-rituals", "wiki": "_meta" } }
```

**Source:** `src/tools/read.ts`

---

### vault_recall

Token-index ranked search; either `topic` or `filter` must be provided. Supports family-scope expansion and a disk-fallback for exact id matches.

**Params:**
- `topic` (string, optional, min 1): Search topic.
- `filter` (string, optional): Filter expression (boolean grammar).
- `wiki` (string, optional): Single wiki to restrict scope.
- `family` (string, optional): Family expansion; ignored when `wiki:` is set.
- `layer` (`"knowledge" | "execution" | "all"`, default `"knowledge"`): Layer segment.
- `include_archive` (boolean, default `false`): Include archived pages.
- `limit` (positive int, default `20`): Max hits returned.
- `by_agent` (string, optional): Filter to pages authored by the given agent id (alias-aware).

**Returns:** `{ hits, segmented, total_candidates, ... }`. On zero hits, a verbatim-id disk match falls through as a single hit.

**Errors:** `topic or filter must be provided`; `FilterParseError` returns as `{ error: { message, position } }` rather than throwing.

**Example:**
```json
{ "tool": "vault_recall", "args": { "topic": "synthesis ritual", "limit": 10 } }
```

**Source:** `src/tools/recall.ts`

---

### vault_reindex

Regenerate `_index/*.json` sidecars and per-wiki `index.md` rollups.

**Params:**
- `wiki` (string, optional): Restrict reindex to a single wiki.

**Returns:** Per-wiki and aggregate counts from `core/reindex.reindex`.

**Errors:** Filesystem errors propagate; map auto-sections are NOT regenerated (deferred indefinitely per architecture spec).

**Example:**
```json
{ "tool": "vault_reindex", "args": {} }
```

**Source:** `src/tools/reindex.ts`

---

### vault_set-active

Write `<vault>/.active-wiki` so subsequent tool calls without `wiki:` resolve to this wiki.

**Params:**
- `wiki` (string, required): Wiki slug; must exist on disk.

**Returns:** `{ active_wiki }`.

**Errors:** `wiki does not exist: <name>` if `wikis/<name>/` is absent.

**Example:**
```json
{ "tool": "vault_set-active", "args": { "wiki": "_meta" } }
```

**Source:** `src/tools/set-active.ts`

---

### vault_synthesize

Compile or refresh a synthesis page. With `by_agent` + `scope=memory`, writes a per-agent memory synthesis under `_agents/synthesis/` and injects a marker-bounded `## Learnings` block clustered by tag.

**Params:**
- `topic` (string, required, min 1): Synthesis topic.
- `wiki` (string, optional): Wiki for non-memory scope.
- `inputs` (array of strings, optional): Explicit input page ids to cite.
- `by_agent` (string, optional): Agent id; activates per-agent memory pass when paired with `scope=memory`.
- `scope` (`"topic" | "memory"`, default `"topic"`): Memory scope forces wiki to `_agents`.
- `prose` (string, optional): Pre-composed prose for the page body.

**Returns:** `{ path, id, inputs_used, last_compiled, ... }`.

**Errors:** Filesystem errors propagate; missing destination directories are auto-created for memory scope.

**Example:**
```json
{ "tool": "vault_synthesize", "args": { "topic": "claims design", "wiki": "_meta" } }
```

**Source:** `src/tools/synthesize.ts`

---

## Coordination

### vault_agent-journal

Append a first-person agent journal entry under `wikis/<wiki>/journal/`. Auto-fills `id`, `created`, `author`, write-through-upserts the page into the index.

**Params:**
- `entry` (string, required, min 1): Body content.
- `wiki` (string, optional): Destination wiki.
- `agent_id` (string, default `"claude-code"`): Bare agent id (becomes `author: agent:<id>`).
- `session_id` (string, optional): Session correlation handle.
- `channel` (string, optional, regex `^[a-z0-9]+(-[a-z0-9]+)*$`): Channel tag.
- `duration_minutes` (non-negative int, optional): Task duration.

**Returns:** `{ id, path, created }`.

**Errors:** `WikiRequiredError` when wiki unresolved.

**Example:**
```json
{ "tool": "vault_agent-journal", "args": { "entry": "promoted draft synthesis-onboarding to active", "agent_id": "pidgey" } }
```

**Source:** `src/tools/agent-journal.ts`

---

### vault_channel

`mode: post | tail`. Consolidates the former channel-post and channel-tail tools.

- **post**: Post a message to a coordination channel. Writes a journal entry with `channel:` set so subsequent tail calls can pick it up.
- **tail**: Pull recent journal entries on a channel since a timestamp.

**Params (post):**
- `mode` (`"post"`, required).
- `channel` (string, required, regex `^[a-z0-9]+(-[a-z0-9]+)*$`): Channel slug.
- `content` (string, required, min 1): Message body.
- `wiki` (string, optional): Destination wiki for the underlying journal.
- `agent_id` (string, default `"claude-code"`).
- `session_id` (string, optional).

**Returns (post):** `{ id, path, created }` from the underlying journal write.

**Errors (post):** `WikiRequiredError`; regex failures on `channel`.

**Example (post):**
```json
{ "tool": "vault_channel", "args": { "mode": "post", "channel": "stoa-progress", "content": "shipped 1.7.1 push primitives" } }
```

**Params (tail):**
- `mode` (`"tail"`, required).
- `channel` (string, required, regex `^[a-z0-9]+(-[a-z0-9]+)*$`): Channel slug.
- `since` (string, optional): ISO timestamp; entries before this are skipped.
- `limit` (positive int, default `50`): Cap on returned entries.
- `wiki` (string, optional): Restrict to a single wiki's journal.

**Returns (tail):** `{ entries: TailEntry[], cursor }`.

**Errors (tail):** Regex failure on `channel`.

**Example (tail):**
```json
{ "tool": "vault_channel", "args": { "mode": "tail", "channel": "stoa-progress", "limit": 20 } }
```

**Source:** `src/tools/channel.ts`

---

## Tasks

### vault_task

`mode: create | list | update | claim`. Consolidates the former task-create, task-list, task-update, and task-claim tools.

- **create**: Create a new task in a wiki's task queue. Status starts as `pending` and the page is write-through-upserted into the index.
- **list**: List tasks vault-wide or filtered. Alias-aware on `claimed_by`.
- **update**: Update a task's status, notes, or segregation. Uses mtime OCC and write-through-upserts the index.
- **claim**: Atomic claim on a `pending` task via mtime optimistic concurrency. If the task has `required_pokemon_type`, the claimant's profile must match.

**Params (create):**
- `mode` (`"create"`, required).
- `title` (string, required, min 1).
- `wiki` (string, required).
- `description` (string, optional).
- `segregation` (array of strings, optional): Glob array claiming exclusive file scope.
- `blocking` (array of strings, optional): Other task ids this depends on.
- `channel` (string, optional): Coordination channel.
- `required_pokemon_type` (string, optional): Restrict claim to a Pokemon type.
- `estimate_minutes` (non-negative int, optional).

**Returns (create):** `{ id, path, ... }`.

**Errors (create):** Filesystem errors on write.

**Example (create):**
```json
{ "tool": "vault_task", "args": { "mode": "create", "title": "Refresh stale syntheses", "wiki": "_meta" } }
```

**Params (list):**
- `mode` (`"list"`, required).
- `wiki` (string, optional).
- `status` (`"pending" | "claimed" | "in_progress" | "completed" | "failed" | "blocked"`, optional).
- `claimed_by` (string, optional): Agent id (`agent:<bare>` or bare).
- `channel` (string, optional).
- `pokemon_type` (string, optional).
- `limit` (positive int, default `50`).

**Returns (list):** `{ tasks: TaskSummary[] }`.

**Errors (list):** None routine.

**Example (list):**
```json
{ "tool": "vault_task", "args": { "mode": "list", "status": "pending", "wiki": "_meta" } }
```

**Params (update):**
- `mode` (`"update"`, required).
- `task_id` (string, required).
- `wiki` (string, required).
- `expected_updated` (string, required): OCC handle.
- `status` (status enum, optional).
- `notes` (string, optional).
- `segregation` (array of strings, optional).
- `agent_id` (string, optional).

**Returns (update):** Updated task summary.

**Errors (update):** OCC mismatch throws.

**Example (update):**
```json
{ "tool": "vault_task", "args": { "mode": "update", "task_id": "task-refresh-syntheses", "wiki": "_meta", "expected_updated": "2026-05-12", "status": "completed" } }
```

**Params (claim):**
- `mode` (`"claim"`, required).
- `task_id` (string, required).
- `agent_id` (string, required): The claimant's bare profile id.
- `expected_updated` (string, required): OCC handle from the prior read.
- `wiki` (string, optional).

**Returns (claim):** `{ task_id, claimed_by, updated, ... }` on success.

**Errors (claim):** `AlreadyClaimedError` when another agent won the race; OCC mismatch on stale `expected_updated`; type mismatch when `required_pokemon_type` set and the claimant doesn't match.

**Example (claim):**
```json
{ "tool": "vault_task", "args": { "mode": "claim", "task_id": "task-refresh-syntheses", "agent_id": "pidgey", "expected_updated": "2026-05-12" } }
```

**Source:** `src/tools/task.ts`

---

## Claims

### vault_claim

Single authoring primitive over four claim actions: create, revalidate, supersede (optionally with `override`), retract. Identity is `(key, scope_hash)`; supersession compares effective confidence.

**Params:**
- `key` (string, optional): Required for create/revalidate/supersede.
- `title` (string, optional).
- `body` (string, optional).
- `profile` (array of strings, optional): Defaults to `[<as>]`; pass `[]` for global scope.
- `move` (array of strings, optional).
- `scope_wiki` (array of strings, optional).
- `tags` (array of strings, optional).
- `confidence` (number 0..1, optional, default `0.7`).
- `evidence` (array of strings, optional).
- `as` (string, required, min 1): Caller identity for `authored_by`.
- `override` (boolean, optional): Force supersession.
- `revalidate` (boolean, optional): Bump `last_validated`.
- `retract` (string, optional): Claim id to retract.
- `reason` (string, optional): Required with `retract`.
- `source_type` (`"lived" | "curricular" | "retro"`, optional, default `"lived"`): Claim provenance. `lived` cites real work evidence; `curricular` cites a `guide-course-*` page; `retro` cites older artifacts a pattern was extracted from. Written to claim frontmatter as `source_type:`. Validated against the fixed value set on write. CLI subcommand not yet exposed — call via MCP tool.
- `wiki` (string, optional): Destination wiki; falls back to `defaultWiki` then `_agents`.

**Returns:** `{ claim_id, action, superseded_id?, rejection?, reindex_recommended: true }`. `action` is one of `created | revalidated | superseded | retracted | rejected`.

**Errors:** `override/revalidate/retract` are mutually exclusive; `--reason is required for retraction`; only `authored_by` can retract; supersede on lower confidence returns `action: "rejected"` rather than throwing.

**Example:**
```json
{ "tool": "vault_claim", "args": { "key": "prefer-tdd-cycle-for-bugfixes", "title": "Prefer TDD for bugfixes", "as": "pidgey", "confidence": 0.8 } }
```

Authoring a curricular claim from a course walkthrough:
```json
{ "tool": "vault_claim", "args": { "key": "crewtracks.integration-test-harness", "title": "CrewTracks integration test harness location", "as": "onix", "source_type": "curricular", "evidence": ["[[wikis/crewtracks/guides/guide-course-crewtracks-onboarding]]"], "scope_wiki": ["crewtracks"], "confidence": 0.62 } }
```

**Source:** `src/tools/claim.ts`

---

### vault_list-claims

Read-only claim listing with bucket filter, status filter, effective-confidence floor, sort by effective confidence desc. Falls back to a disk walk when `_index/claims.json` is missing.

**Params:**
- `by` (`"profile" | "move" | "tag" | "scope_wiki" | "global"`, optional): Bucket dimension.
- `value` (string, optional): Bucket value (required for non-global).
- `min_effective_confidence` (number 0..1, optional): Defaults to `render_min_confidence` config (0.4).
- `status` (array of `"active" | "superseded" | "retracted"`, default `["active"]`).
- `source_type` (`"lived" | "curricular" | "retro"`, optional): Filter claims by `source_type:` frontmatter. Reads the `by_source_type` bucket on `_index/claims.json` schema_version 3; falls back to a disk-walk filter when the bucket is absent (schema_version 1 or 2). Composes with other filters. CLI subcommand not yet exposed — call via MCP tool.
- `limit` (positive int, optional): Defaults to `render_default_limit` config (10).
- `wiki` (string, optional).

**Returns:** `{ claims: ClaimEntry[], total, index_age_seconds }`.

**Errors:** None routine.

**Example:**
```json
{ "tool": "vault_list-claims", "args": { "by": "profile", "value": "pidgey" } }
```

Filtering to only curricular claims for a profile:
```json
{ "tool": "vault_list-claims", "args": { "by": "profile", "value": "onix", "source_type": "curricular" } }
```

**Source:** `src/tools/list-claims.ts`

---

## Agent substrate

### vault_agent-memory

Pull an agent's accumulated claims at decision time — decay-aware, scope-filtered, ranked. Read-only and idempotent. See `docs/agent-memory.md` for the deep-dive (predicate, calibration table, detail tiers).

**Params:**
- `agent_id` (string, required): Bare profile id (`agent:` and `profile-` prefixes are stripped on input).
- `task` (string, optional): Task id; tool derives `scope_wiki` + `tags` from the task page.
- `tags` (array of strings, optional): Explicit tag scope.
- `scope_wiki` (array of strings, optional): Explicit wiki scope.
- `token_budget` (positive int, optional): Pack claims by descending score until next would exceed budget.
- `limit` (positive int, default `10`).
- `detail` (`"summary" | "truncated" | "full"`, default `"truncated"`).
- `include_questions` (boolean, default `false`).

**Returns:** `{ agent_id, scope_used, claims, total_pool_size, truncated }`. Each `claims[]` entry includes `id`, `key`, `summary`, `body` (sized per `detail`), `effective_confidence`, `scope_match_score`, `score`, `authored_by`, plus three v0.3 substrate fields:
- `source_type` (`"lived" | "curricular" | "retro"`) — raw provenance value. Defaults to `"lived"` if claim frontmatter is absent.
- `source_type_tag` (string) — formatted display token like `"[curricular | 0.62]"`. The bracketed number is `effective_confidence` rounded to two decimals.
- `rendered` (string) — canonical agent-facing string `"[<source_type> | <conf>] <body>"`. Use this when injecting claims directly into a system prompt; pre-rendered to keep the tag + body presentation consistent across callers.

Ranking is unaffected by `source_type` — the tag is informational, not load-bearing for retrieval. (Source-type weights *do* apply in `vault_evolve-profile` cluster math; see that tool's entry.)

**Errors:** None routine; unknown `agent_id` returns empty result, missing `--task` falls back to non-task scope.

**Example:**
```json
{ "tool": "vault_agent-memory", "args": { "agent_id": "onix", "task": "task-wire-feature-x", "detail": "full" } }
```

**Source:** `src/tools/agent-memory.ts`

---

### vault_bootstrap-repo

Wire a repo to the vault MCP: writes `.mcp.json`, appends a CLAUDE.md fragment, optionally deploys a Pokemon's moveset.

**Params:**
- `repo_path` (string, required): Target repo absolute path.
- `wiki` (string, required): Wiki this repo's work belongs to. When `pokemon:` is set, every `wikis/<wiki>/moves/<id>/SKILL.md` is layered onto the portable moveset at deploy time. The generated CLAUDE.md fragment renders `### Portable moves` and `### Specialist moves (<wiki>)` as distinct subsections; on id collision, portable wins (with a `MOVE_ID_SHADOWS_PORTABLE` lint warning).
- `pokemon` (string, optional): Profile id to deploy.
- `channels` (array of strings, optional): Channels to tail/post on.
- `mcp_server_name` (string, default `"vault"`): MCP server registration name.

**Returns:** `{ files_written, moveset_synced, channels_configured }`.

**Errors:** `PROFILE_NOT_FOUND: <id>` when `pokemon:` is set but the profile is missing.

**Example:**
```json
{ "tool": "vault_bootstrap-repo", "args": { "repo_path": "/abs/path/to/repo", "wiki": "_meta", "pokemon": "pidgey" } }
```

**Source:** `src/tools/bootstrap-repo.ts`

---

### vault_evolve-profile

Two-phase profile evolution. `commit: false` returns a proposal (eligibility, proposed stage/autonomy/moveset, claim-driven specialties + moveset suggestions, rationale). `commit: true` applies it; renames are recorded via the alias overlay.

**Params:**
- `pokemon_id` (string, required).
- `commit` (boolean, default `false`).
- `expected_updated` (string, optional): Required when `commit: true`.
- `proposal` (ProposalShape, optional): Required when `commit: true`; mirrors phase-1 output.
- `cleanup_old_skills_dir` (boolean, default `true`): On rename, remove the pre-rename per-deployment skills dir before re-deploying.
- `wiki` (string, optional): Falls back to resolved trainer context.

**Returns:** Phase 1: full proposal. Phase 2: `{ old_id, new_id, files_renamed, files_resynced, alias_recorded, caller_trainer_id }`.

**Errors:** `expected_updated is required when commit:true`; OCC conflict on stale `expected_updated`; `profile id <new> already exists` on rename collision; `ProfileNotFoundError` on missing pokemon.

**Example:**
```json
{ "tool": "vault_evolve-profile", "args": { "pokemon_id": "profile-charmander", "commit": false } }
```

**Source:** `src/tools/evolve-profile.ts`

---

### vault_stadium-list (`mode: platform-profiles`)

`mode: platform-profiles`. List Stadium-registered profiles in the resolved wiki — the draft pool. Hydrates `real_skill_levels` from each move's SKILL.md. (For `mode: invites`, see the [Stadium](#stadium) section.)

**Params:**
- `mode` (`"platform-profiles"`, required).
- `wiki` (string, optional): Falls back to resolved trainer context.
- `owner_trainer_id` (string, optional, regex `^[0-9A-Z]{26}$`): Filter by ULID trainer.

**Returns:** `{ profiles: PlatformProfileRow[], caller_trainer_id }`.

**Errors:** `TrainerContextError` when neither `wiki:` nor trainer context resolves.

**Example:**
```json
{ "tool": "vault_stadium-list", "args": { "mode": "platform-profiles" } }
```

**Source:** `src/tools/stadium-list.ts`

---

### vault_profile-stats

Per-profile counts (tasks done/failed/in-flight, journals, channels, moves-used) plus next-evolution threshold. Reads `_index/profiles.json`.

**Params:**
- `pokemon_id` (string, required).
- `wiki` (string, optional): Falls back to resolved trainer context.

**Returns:** `{ profile_id, pokemon_type, evolution_stage, days_since_creation, tasks_completed, tasks_failed, tasks_in_flight, success_rate, journals_count, channels_active, moves_used_freq, next_evolution_threshold?, caller_trainer_id }`.

**Errors:** `PROFILE_NOT_FOUND: _index/profiles.json missing — run vault_reindex first` when the sidecar is absent.

**Example:**
```json
{ "tool": "vault_profile-stats", "args": { "pokemon_id": "profile-pidgey" } }
```

**Source:** `src/tools/profile-stats.ts`

---

### vault_refresh-profile-memory

Convenience wrapper around `vault_synthesize` with `by_agent` + `scope=memory`. Writes `wikis/_agents/synthesis/synthesis-<bare-name>-memory.md`. Idempotent.

**Params:**
- `pokemon_id` (string, required).
- `wiki` (string, optional): Falls back to resolved trainer context.

**Returns:** `{ memory_page_id, path, inputs_used_count, last_compiled, caller_trainer_id }`.

**Errors:** `ProfileNotFoundError` when the profile is missing at the resolved wiki path.

**Example:**
```json
{ "tool": "vault_refresh-profile-memory", "args": { "pokemon_id": "profile-pidgey" } }
```

**Source:** `src/tools/refresh-profile-memory.ts`

---

### vault_start

Cold-session bootstrap: reads wiki map (or family map if scoped), lists active pages, computes channel activity, optionally hydrates Pokemon state and renders an ASCII sprite header. Writes `_index/statusline.json` when a Pokemon is given.

**Params:**
- `wiki` (string, optional): Single-wiki scope.
- `family` (string, optional): Family scope; ignored when `wiki:` set.
- `pokemon` (string, optional): Profile to load.
- `topics` (array of strings, optional): Currently unused by the recall pass (returns `recall_hits: []`).
- `since` (string, optional, ISO datetime): Channel-activity lookback; defaults to 24h ago.

**Returns:** `{ map_summary, active_pages_summary, recall_hits, channel_activity, pokemon_state?, ascii_header? }`.

**Errors:** `WikiRequiredError` when no wiki and no family resolves; sprite render failures are silently downgraded.

**Example:**
```json
{ "tool": "vault_start", "args": { "wiki": "_meta", "pokemon": "pidgey" } }
```

**Source:** `src/tools/start.ts`

---

### vault_suggest-pokemon

Suggest Pokemon names matching a type or dev specialty (e.g. `"backend"` → fire). PokeAPI-backed, 30-day cache. Excludes existing profile names by default.

**Params:**
- `pokemon_type` (string, optional): A valid Pokemon type.
- `dev_specialty` (string, optional): Dev specialty mapped to a type via `mapDevSpecialty`.
- `evolution_stage` (`"basic" | "stage1" | "stage2"`, optional).
- `exclude_existing` (boolean, default `true`): Skip names already registered as profiles.
- `limit` (positive int, default `5`).

**Returns:** `{ suggestions: [...] }`.

**Errors:** `either pokemon_type or dev_specialty is required`; `invalid pokemon_type: <name>`.

**Example:**
```json
{ "tool": "vault_suggest-pokemon", "args": { "dev_specialty": "backend", "limit": 3 } }
```

**Source:** `src/tools/suggest-pokemon.ts`

---

### vault_sync

`surface: skills | agents`. Consolidates the former sync-skills and sync-agents tools. NOTE: the discriminator is `surface`, not `mode`, because both surfaces retain their own `mode: copy | symlink` field.

- **skills**: Deploy a Pokemon's moveset into a target repo's local skills directory. With `reverify: true`, scans existing deployments for drift instead of deploying. Accepts `runtime: claude-code | openclaw | codex`.
- **agents**: Deploy a Pokemon (or list, or `all: true`) as runtime subagent definitions in the target repo. Builds a `SubagentIntent` per profile, writes `<target>/.claude/agents/<pokemon-id>.md` plus optional moveset SKILL.md files. Idempotent on `source_revision`. Accepts only `runtime: claude-code`.

**Common fields:**
- `surface` (`"skills" | "agents"`, required): Which deployment surface to target.
- `mode` (`"copy" | "symlink"`, default `"symlink"` for skills, `"copy"` for agents): Write strategy.

**Params (surface: skills):**
- `repo_path` (string, required): Filesystem path to the target repo.
- `runtime` (`"claude-code" | "openclaw" | "codex"`, default `"claude-code"`): Output format.
- `mode` (`"copy" | "symlink"`, default `"symlink"`).
- `pokemon` (string, optional): Required unless `reverify: true` or `all: true`.
- `all` (boolean, default `false`): Deploy every matching profile; mutually exclusive with `pokemon`.
- `exclude` (array of strings, default `[]`).
- `pokemon_type` (array of strings, default `[]`).
- `reverify` (boolean, default `false`): Scan deployments for drift.
- `fix` (boolean, default `false`): Re-deploy drifted moves; requires `reverify: true`.
- `continue_on_error` (boolean, default `false`).
- `wiki` (string, optional): Layers `wikis/<wiki>/moves/<id>/SKILL.md` specialist moves at deploy time. **CLI surface gap:** the `vault sync-skills` CLI subcommand does not currently expose `--wiki=`; use `vault bootstrap-repo --wiki=` from the terminal, or invoke the MCP tool directly.

**Returns (skills):** Single-pokemon flat shape `{ skills_dir, moves_synced, moves_skipped_unsupported }`; multi-profile envelope `{ results, summary }`; reverify shape `{ drift, drift_fixed }`.

**Errors (skills):** `pokemon and all are mutually exclusive`; `deploy mode requires pokemon or all: true`; `fix: true requires reverify: true`.

**Example (skills):**
```json
{ "tool": "vault_sync", "args": { "surface": "skills", "repo_path": "/abs/path/repo", "pokemon": "pidgey" } }
```

**Params (surface: agents):**
- `repo_path` (string, required): Filesystem path to the target repo.
- `runtime` (`"claude-code"`, default `"claude-code"`): Agents only supports claude-code.
- `mode` (`"copy" | "symlink"`, default `"copy"`).
- `overwrite` (boolean, default `true`).
- `include_moveset` (boolean, default `true`).
- `continue_on_error` (boolean, default `false`): Halt-on-first-error by default.
- `pokemon` (string or string array, optional): Mutually exclusive with `all`.
- `all` (boolean, default `false`).
- `exclude` (array of strings, default `[]`): Only valid with `all: true`.
- `pokemon_type` (array of strings, default `[]`): Only valid with `all: true`.

**Returns (agents):** `{ results: PerPokemonResult[], summary: { requested, deployed, skipped, failed } }`.

**Errors (agents):** `pokemon and all are mutually exclusive`; `one of pokemon or all: true is required`; `exclude and pokemon_type are only valid with all: true`.

**Example (agents):**
```json
{ "tool": "vault_sync", "args": { "surface": "agents", "repo_path": "/abs/path/repo", "pokemon": "pidgey" } }
```

**Source:** `src/tools/sync.ts`

---

## Sync primitives

### vault_wait-for

`mode: next | any | all | many`. Consolidates the former wait-for-any, wait-for-all, and wait-for-many tools under a single `mode` discriminator.

- **next**: single `filter`. Resolves on the first matching event. Returns immediately if the `since` cursor reveals a matching event.
- **any**: `filters[]`. Resolves on the first event matching any filter (first-of-N).
- **all**: `filters[]`. Resolves once every filter has been satisfied (fan-in).
- **many**: `filter` + `max`. Collects up to `max` events matching the filter (bounded batch).

**Common params:**
- `mode` (`"next" | "any" | "all" | "many"`, required).
- `since` (string, optional): Prior cursor (ISO with seq).
- `timeout_ms` (positive int, max 120000, default `25000`).

**Params (mode: next):**
- `filter` (object, required): `{ source, wiki?, channel?, id? }`.

**Returns (next):** `{ events, cursor, timed_out }`.

**Errors (next):** None routine; max timeout is 120s.

**Example (next):**
```json
{ "tool": "vault_wait-for", "args": { "mode": "next", "filter": { "source": "journal", "channel": "stoa-progress" } } }
```

**Params (mode: any / all):**
- `filters` (array of filter objects, required, min 1 max 32).

**Returns (any):** `{ events, cursor, timed_out }`.

**Returns (all):** `{ events, cursor, timed_out }`.

**Errors (any / all):** Array length out-of-range fails Zod.

**Example (any):**
```json
{ "tool": "vault_wait-for", "args": { "mode": "any", "filters": [{ "source": "vault_match-watch" }, { "source": "journal", "channel": "stadium-alerts" }] } }
```

**Example (all):**
```json
{ "tool": "vault_wait-for", "args": { "mode": "all", "filters": [{ "source": "task", "id": "task-a" }, { "source": "task", "id": "task-b" }] } }
```

**Params (mode: many):**
- `filter` (object, required).
- `max` (positive int, max 1000, required).

**Returns (many):** `{ events, cursor, timed_out }`.

**Errors (many):** Zod range failures.

**Example (many):**
```json
{ "tool": "vault_wait-for", "args": { "mode": "many", "filter": { "source": "journal" }, "max": 50 } }
```

**Source:** `src/tools/wait-for.ts`

---

## Stadium

All Stadium tools authenticate via `resolveStadiumConfig` and require an active trainer context (see top of file). Server errors propagate as `StadiumApiError`; callers see the platform's `error_code` directly.

### vault_stadium-list

`mode: invites | platform-profiles`. Consolidates the former list-invites and list-platform-profiles tools.

- **invites**: List pending match invites for the calling trainer.
- **platform-profiles**: List Stadium-registered profiles in the resolved wiki — the draft pool. (Also documented in [Agent substrate](#agent-substrate) for discovery.)

**Params (invites):**
- `mode` (`"invites"`, required).

**Returns (invites):** Platform `listInvites` response.

**Errors (invites):** `StadiumApiError`.

**Example (invites):**
```json
{ "tool": "vault_stadium-list", "args": { "mode": "invites" } }
```

**Params (platform-profiles):**
- `mode` (`"platform-profiles"`, required).
- `wiki` (string, optional): Falls back to resolved trainer context.
- `owner_trainer_id` (string, optional, regex `^[0-9A-Z]{26}$`): Filter by ULID trainer.

**Returns (platform-profiles):** `{ profiles: PlatformProfileRow[], caller_trainer_id }`.

**Errors (platform-profiles):** `TrainerContextError` when neither `wiki:` nor trainer context resolves.

**Example (platform-profiles):**
```json
{ "tool": "vault_stadium-list", "args": { "mode": "platform-profiles" } }
```

**Source:** `src/tools/stadium-list.ts`

---

### vault_match-watch

Poll a match until terminal status (`completed`, `forfeit_a`, `forfeit_b`, `draw`), then write a result journal under `wikis/<wiki>/journal/`.

**Params:**
- `match_id` (string, required, min 1).
- `wiki` (string, optional).
- `poll_interval_ms` (positive int, default `1500`).
- `max_wait_ms` (positive int, default `600000`): Hard 10-minute ceiling.

**Returns:** `{ match_id, status, journal_path }`.

**Errors:** Throws if the match does not terminate within `max_wait_ms`; `WikiRequiredError` when wiki unresolved.

**Example:**
```json
{ "tool": "vault_match-watch", "args": { "match_id": "01H..." } }
```

**Source:** `src/tools/match-watch.ts`

---

### vault_move-fuse

Fuse a canonical PokeAPI move with a registered real-skill into a usable `move_id`.

**Params:**
- `canonical_move_name` (string, required, regex `^[a-z0-9-]+$`).
- `real_skill_id` (string, required, min 1).

**Returns:** `{ move_id }`.

**Errors:** `StadiumApiError`.

**Example:**
```json
{ "tool": "vault_move-fuse", "args": { "canonical_move_name": "ember", "real_skill_id": "rs_..." } }
```

**Source:** `src/tools/move-fuse.ts`

---

### vault_profile-register

Register a profile with the Stadium platform; persist `platform_profile_id` + `platform_stats` back to the file.

**Params:**
- `profile_id` (string, required, regex `^profile-`).
- `wiki` (string, optional): Falls back to resolved trainer context.

**Returns:** `{ profile_id, stats, caller_trainer_id }`.

**Errors:** `profile <id> missing 'pokemon' field`; type check on `pokemon`; `TrainerContextError` when wiki cannot be resolved; `StadiumApiError`.

**Example:**
```json
{ "tool": "vault_profile-register", "args": { "profile_id": "profile-pidgey" } }
```

**Source:** `src/tools/profile-register.ts`

---

### vault_real-skill

`mode: register | refresh`. Consolidates the former real-skill-register and real-skill-refresh tools.

- **register**: Register a real-skill (`move-*/SKILL.md`) with Stadium; persist returned `real_skill_id` + advisory `combat:` block.
- **refresh**: Re-derive a registered real-skill's modifier function from the current SKILL.md content.

**Params (register):**
- `mode` (`"register"`, required).
- `skill_id` (string, required, regex `^move-`).
- `wiki` (string, optional).

**Returns (register):** `{ real_skill_id, modifier_function }`.

**Errors (register):** `StadiumApiError` (`modifier_clamped`, `derivation_failed`, etc.); `WikiRequiredError`.

**Example (register):**
```json
{ "tool": "vault_real-skill", "args": { "mode": "register", "skill_id": "move-tdd-cycle" } }
```

**Params (refresh):**
- `mode` (`"refresh"`, required).
- `skill_id` (string, required, regex `^move-`).
- `wiki` (string, optional).

**Returns (refresh):** `{ real_skill_id, modifier_function }`.

**Errors (refresh):** `<id> has no real_skill_id — register first via vault_real-skill with mode: register`; `StadiumApiError`.

**Example (refresh):**
```json
{ "tool": "vault_real-skill", "args": { "mode": "refresh", "skill_id": "move-tdd-cycle" } }
```

**Source:** `src/tools/real-skill.ts`

---

### vault_telemetry-push

Push a move-usage event to Stadium; increments server-side XP for the named real-skill.

**Params:**
- `real_skill_id` (string, required, min 1).
- `source` (string, required, min 1).
- `reference_link` (string, required, min 1).

**Returns:** Platform `pushTelemetry` response.

**Errors:** `StadiumApiError` (`unknown_real_skill_id`, `rate_limited`, etc.).

**Example:**
```json
{ "tool": "vault_telemetry-push", "args": { "real_skill_id": "rs_...", "source": "journal-...", "reference_link": "https://..." } }
```

**Source:** `src/tools/telemetry-push.ts`

---

### vault_trainer-accept-match

Accept a `pending_invite` match; transitions to drafting.

**Params:**
- `match_id` (string, required, min 1).
- `wiki` (string, optional, min 1).

**Returns:** Platform response merged with `{ caller_trainer_id, resolved_wiki }`.

**Errors:** `TrainerContextError`; `StadiumApiError`.

**Example:**
```json
{ "tool": "vault_trainer-accept-match", "args": { "match_id": "01H..." } }
```

**Source:** `src/tools/trainer-accept-match.ts`

---

### vault_trainer-get-state

Fetch authenticated match state; supports `since_turn` for incremental polling. During the drafting phase, also returns `available_profiles` (the caller's draft pool).

**Params:**
- `match_id` (string, required, min 1).
- `since_turn` (non-negative int, optional).

**Returns:** Platform state extended with `{ caller_trainer_id, caller_side, waiting_for_move, available_profiles? }`.

**Errors:** `caller is not a participant in this match`; `getMatchState: unexpected non-object response`; `TrainerContextError`.

**Example:**
```json
{ "tool": "vault_trainer-get-state", "args": { "match_id": "01H..." } }
```

**Source:** `src/tools/trainer-get-state.ts`

---

### vault_trainer-init

Validate the configured Stadium API key and scaffold `wikis/_agents/trainers/trainer-<slug>.md` with the initial strategy seed.

**Params:**
- `name` (string, required, min 1).
- `strategy` (string, optional, min 1).

**Returns:** `{ id, path, trainer_id, caller_trainer_id }`.

**Errors:** `StadiumApiError` if API key validation fails; `TRAINER_WIKI_UNSET` propagates (other trainer-context errors are swallowed because init is the bootstrapping path).

**Example:**
```json
{ "tool": "vault_trainer-init", "args": { "name": "Brett" } }
```

**Source:** `src/tools/trainer-init.ts`

---

### vault_trainer-queue-match

Create a match invite against an opponent trainer; returns `match_id` in `pending_invite` state.

**Params:**
- `opponent_trainer_id` (string, required, min 1).
- `ruleset` (`"standard"`, default `"standard"`).
- `wiki` (string, optional, min 1).

**Returns:** Platform response merged with `{ caller_trainer_id, resolved_wiki }`.

**Errors:** `TrainerContextError` when wiki cannot be resolved; `StadiumApiError`.

**Example:**
```json
{ "tool": "vault_trainer-queue-match", "args": { "opponent_trainer_id": "trainer-foo" } }
```

**Source:** `src/tools/trainer-queue-match.ts`

---

### vault_trainer-submit

`mode: draft | move`. Consolidates the former trainer-submit-draft and trainer-submit-move tools.

- **draft**: Submit 6 picks (platform_profile_ids as ULIDs) during a match's drafting phase.
- **move**: Submit a move for the current turn; the server resolves the turn once both trainers submit.

**Params (draft):**
- `mode` (`"draft"`, required).
- `match_id` (string, required, regex `^[0-9A-Z]{26}$`).
- `picks` (array of strings, required, length exactly 6, each regex `^[0-9A-Z]{26}$`).

**Returns (draft):** Platform response merged with `{ caller_trainer_id }`.

**Errors (draft):** `InvalidPicksShapeError` (`INVALID_PICKS_SHAPE`) on any Zod failure (wraps the ZodError); `StadiumApiError`.

**Example (draft):**
```json
{ "tool": "vault_trainer-submit", "args": { "mode": "draft", "match_id": "01H...", "picks": ["01H...","01H...","01H...","01H...","01H...","01H..."] } }
```

**Params (move):**
- `mode` (`"move"`, required).
- `match_id` (string, required, min 1).
- `turn` (non-negative int, required).
- `move_id` (string, required, min 1).
- `target` (string, optional).

**Returns (move):** Platform response merged with `{ caller_trainer_id }`.

**Errors (move):** `submitMove: unexpected non-object response`; `StadiumApiError`.

**Example (move):**
```json
{ "tool": "vault_trainer-submit", "args": { "mode": "move", "match_id": "01H...", "turn": 3, "move_id": "ember-rs_..." } }
```

**Source:** `src/tools/trainer-submit.ts`

---

## Misc

### vault_merge

`mode: queue | record`. Consolidates the former merge-queue and merge-record tools.

- **queue**: READ the bulk merge queue for a coordination channel. Pure read; `ci_status` is always `"unknown"`.
- **record**: WRITE a merge outcome for a PR: write a journal entry, and when `status === "merged"` with a `task_id`, transition the source task to `completed`. Halt/fail statuses write the journal but do NOT touch the task.

**Params (queue):**
- `mode` (`"queue"`, required).
- `channel` (string, required).
- `wiki` (string, optional).
- `family` (string, optional).
- `since` (string, optional, ISO datetime): Defaults to 7 days ago.

**Returns (queue):** `MergeQueueOutput` (ready_prs, unready_prs, ordered, etc.).

**Errors (queue):** None routine; family/wiki resolution may yield an empty queue.

**Example (queue):**
```json
{ "tool": "vault_merge", "args": { "mode": "queue", "channel": "stoa-progress" } }
```

**Params (record):**
- `mode` (`"record"`, required).
- `pr_number` (int, required).
- `channel` (string, required).
- `agent_id` (string, required): Bare or `agent:<bare>` or `profile-<bare>`. Alias-resolved.
- `merge_commit_sha` (string, optional).
- `status` (`"merged" | "failed" | "halted-conflict" | "halted-red-ci"`, required).
- `notes` (string, optional).
- `task_id` (string, optional).

**Returns (record):** `{ journal_id, recorded_at, task_updated }`.

**Errors (record):** `UnknownAgentError` when `agent_id` cannot be resolved to a profile (no journal written); missing task surfaces as `task_updated: false` silently.

**Example (record):**
```json
{ "tool": "vault_merge", "args": { "mode": "record", "pr_number": 42, "channel": "stoa-progress", "agent_id": "pidgey", "status": "merged", "task_id": "task-ship-doc" } }
```

**Source:** `src/tools/merge.ts`

---

### vault_rewrite-links

Bulk-rewrite wikilink prefixes across the vault (body + frontmatter `related:`). Code-fence-safe; idempotent; dry-run by default. Used for family migrations and wiki renames.

**Params:**
- `from_prefix` (string, required).
- `to_prefix` (string, required).
- `dry_run` (boolean, default `false`).
- `scopes` (array of `"body" | "frontmatter" | "all"`, default `["all"]`).

**Returns:** `{ pages_modified: [{page_id, links_rewritten}], total_links, reindex_run }`. Non-dry-run with non-zero changes auto-runs reindex.

**Errors:** Filesystem errors propagate; malformed pages are skipped.

**Example:**
```json
{ "tool": "vault_rewrite-links", "args": { "from_prefix": "wikis/old-name/", "to_prefix": "wikis/new-name/", "dry_run": true } }
```

**Source:** `src/tools/rewrite-links.ts`
