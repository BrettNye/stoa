# Tool reference

Alphabetical reference for every MCP tool exposed by stoa. All tools are registered under the `vault.*` namespace and dispatched via the stdio transport (or, in tests, the shared `callTool` harness). Tools requiring a wiki accept an optional `wiki:` field; resolution order is **explicit arg → `--default-wiki` MCP flag → `.active-wiki` file → error** (see `src/tools/_resolve-wiki.ts`). Stadium tools instead use `resolveTrainerContext` (see `src/core/resolve-trainer-context.ts`): **explicit trainer arg → `STADIUM_TRAINER` env → `~/.vault/stadium.toml` `active=` → error**.

Groups: [Core](#core) · [Coordination](#coordination) · [Tasks](#tasks) · [Claims](#claims) · [Agent substrate](#agent-substrate) · [Sync primitives](#sync-primitives) · [Stadium](#stadium) · [Misc](#misc).

---

## Core

### vault.inbox

Drop a fleeting thought into the resolved wiki's `inbox/` as a datestamped untyped file.

**Params:**
- `thought` (string, required, min 1): The content to capture.
- `wiki` (string, optional): Wiki to write into; falls back to resolution chain.

**Returns:** `{ id, path }` for the new inbox file.

**Errors:** `WikiRequiredError` when the wiki cannot be resolved.

**Example:**
```json
{ "tool": "vault.inbox", "args": { "thought": "consider replacing token index with sqlite FTS5" } }
```

**Source:** `src/tools/inbox.ts`

---

### vault.lint

Read-only health check; emits diagnostics for the resolved wiki (or vault-wide when omitted) at or above the requested severity.

**Params:**
- `wiki` (string, optional): Restrict diagnostics to one wiki.
- `level` (`"error" | "warning" | "info"`, default `"warning"`): Minimum severity returned.

**Returns:** `{ diagnostics: [...], summary: { errors, warnings, info } }`. Each diagnostic carries `code`, `severity`, `message`, and a page reference.

**Errors:** None routine; malformed pages are skipped, not thrown.

**Example:**
```json
{ "tool": "vault.lint", "args": { "wiki": "_meta", "level": "warning" } }
```

**Source:** `src/tools/lint.ts`

---

### vault.list-wikis

List visible wikis with per-wiki page counts, optionally grouped by family.

**Params:**
- `include_reserved` (boolean, default `false`): Include reserved wikis (`_archive`, etc.); `_agents` is always included.
- `family` (string, optional): Filter to wikis whose `family` matches.
- `group_by_family` (boolean, default `false`): Switch return shape to `{ families, unfamilied }`.

**Returns:** `{ wikis: WikiSummary[] }` by default; `{ families, unfamilied }` when `group_by_family: true`. Indexed counts are augmented with on-disk pages absent from `_index/pages.json` (v1.7 §5.4).

**Errors:** None.

**Example:**
```json
{ "tool": "vault.list-wikis", "args": { "group_by_family": true } }
```

**Source:** `src/tools/list-wikis.ts`

---

### vault.new

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
{ "tool": "vault.new", "args": { "type": "guide", "wiki": "_meta", "title": "Onboarding ritual" } }
```

**Source:** `src/tools/new.ts`

---

### vault.new-wiki

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
{ "tool": "vault.new-wiki", "args": { "name": "cooking", "mode": "learning", "scope": "Recipes and technique notes." } }
```

**Source:** `src/tools/new-wiki.ts`

---

### vault.process-inbox

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
{ "tool": "vault.process-inbox", "args": { "wiki": "_meta", "commit": false } }
```

**Source:** `src/tools/process-inbox.ts`

---

### vault.read

Read a page by id; returns frontmatter, body, and the `updated` handle for follow-up OCC writes.

**Params:**
- `id` (string, required): Page id (filename stem).
- `wiki` (string, optional): Wiki to look up the page in.

**Returns:** `{ frontmatter, body, updated, path }`.

**Errors:** Filesystem errors propagate; `WikiRequiredError` if wiki cannot be resolved.

**Example:**
```json
{ "tool": "vault.read", "args": { "id": "guide-vault-rituals", "wiki": "_meta" } }
```

**Source:** `src/tools/read.ts`

---

### vault.recall

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
{ "tool": "vault.recall", "args": { "topic": "synthesis ritual", "limit": 10 } }
```

**Source:** `src/tools/recall.ts`

---

### vault.reindex

Regenerate `_index/*.json` sidecars and per-wiki `index.md` rollups.

**Params:**
- `wiki` (string, optional): Restrict reindex to a single wiki.

**Returns:** Per-wiki and aggregate counts from `core/reindex.reindex`.

**Errors:** Filesystem errors propagate; map auto-sections are NOT regenerated (deferred indefinitely per architecture spec).

**Example:**
```json
{ "tool": "vault.reindex", "args": {} }
```

**Source:** `src/tools/reindex.ts`

---

### vault.set-active

Write `<vault>/.active-wiki` so subsequent tool calls without `wiki:` resolve to this wiki.

**Params:**
- `wiki` (string, required): Wiki slug; must exist on disk.

**Returns:** `{ active_wiki }`.

**Errors:** `wiki does not exist: <name>` if `wikis/<name>/` is absent.

**Example:**
```json
{ "tool": "vault.set-active", "args": { "wiki": "_meta" } }
```

**Source:** `src/tools/set-active.ts`

---

### vault.synthesize

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
{ "tool": "vault.synthesize", "args": { "topic": "claims design", "wiki": "_meta" } }
```

**Source:** `src/tools/synthesize.ts`

---

## Coordination

### vault.agent-journal

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
{ "tool": "vault.agent-journal", "args": { "entry": "promoted draft synthesis-onboarding to active", "agent_id": "pidgey" } }
```

**Source:** `src/tools/agent-journal.ts`

---

### vault.channel-post

Post a message to a coordination channel. Writes a journal entry with `channel:` set so `channel-tail` can pick it up.

**Params:**
- `channel` (string, required, regex `^[a-z0-9]+(-[a-z0-9]+)*$`): Channel slug.
- `content` (string, required, min 1): Message body.
- `wiki` (string, optional): Destination wiki for the underlying journal.
- `agent_id` (string, default `"claude-code"`).
- `session_id` (string, optional).

**Returns:** `{ id, path, created }` from the underlying journal write.

**Errors:** `WikiRequiredError`; regex failures on `channel`.

**Example:**
```json
{ "tool": "vault.channel-post", "args": { "channel": "stoa-progress", "content": "shipped 1.7.1 push primitives" } }
```

**Source:** `src/tools/channel-post.ts`

---

### vault.channel-tail

Pull recent journal entries on a channel since a timestamp.

**Params:**
- `channel` (string, required, regex `^[a-z0-9]+(-[a-z0-9]+)*$`): Channel slug.
- `since` (string, optional): ISO timestamp; entries before this are skipped.
- `limit` (positive int, default `50`): Cap on returned entries.
- `wiki` (string, optional): Restrict to a single wiki's journal.

**Returns:** `{ entries: TailEntry[], cursor }`.

**Errors:** Regex failure on `channel`.

**Example:**
```json
{ "tool": "vault.channel-tail", "args": { "channel": "stoa-progress", "limit": 20 } }
```

**Source:** `src/tools/channel-tail.ts`

---

## Tasks

### vault.task-claim

Atomic claim on a `pending` task via mtime optimistic concurrency. If the task has `required_pokemon_type`, the claimant's profile must match.

**Params:**
- `task_id` (string, required).
- `agent_id` (string, required): The claimant's bare profile id.
- `expected_updated` (string, required): OCC handle from the prior read.
- `wiki` (string, optional).

**Returns:** `{ task_id, claimed_by, updated, ... }` on success.

**Errors:** `AlreadyClaimedError` when another agent won the race; OCC mismatch on stale `expected_updated`; type mismatch when `required_pokemon_type` set and the claimant doesn't match.

**Example:**
```json
{ "tool": "vault.task-claim", "args": { "task_id": "task-refresh-syntheses", "agent_id": "pidgey", "expected_updated": "2026-05-12" } }
```

**Source:** `src/tools/task-claim.ts`

---

### vault.task-create

Create a new task in a wiki's task queue. Status starts as `pending` and the page is write-through-upserted into the index.

**Params:**
- `title` (string, required, min 1).
- `wiki` (string, required).
- `description` (string, optional).
- `segregation` (array of strings, optional): Glob array claiming exclusive file scope.
- `blocking` (array of strings, optional): Other task ids this depends on.
- `channel` (string, optional): Coordination channel.
- `required_pokemon_type` (string, optional): Restrict claim to a Pokemon type.
- `estimate_minutes` (non-negative int, optional).

**Returns:** `{ id, path, ... }`.

**Errors:** Filesystem errors on write.

**Example:**
```json
{ "tool": "vault.task-create", "args": { "title": "Refresh stale syntheses", "wiki": "_meta" } }
```

**Source:** `src/tools/task-create.ts`

---

### vault.task-list

List tasks vault-wide or filtered. Alias-aware on `claimed_by` — historical agent ids surface tasks claimed under their current id.

**Params:**
- `wiki` (string, optional).
- `status` (`"pending" | "claimed" | "in_progress" | "completed" | "failed" | "blocked"`, optional).
- `claimed_by` (string, optional): Agent id (`agent:<bare>` or bare).
- `channel` (string, optional).
- `pokemon_type` (string, optional).
- `limit` (positive int, default `50`).

**Returns:** `{ tasks: TaskSummary[] }`.

**Errors:** None routine.

**Example:**
```json
{ "tool": "vault.task-list", "args": { "status": "pending", "wiki": "_meta" } }
```

**Source:** `src/tools/task-list.ts`

---

### vault.task-update

Update a task's status, notes, or segregation. Uses mtime OCC and write-through-upserts the index.

**Params:**
- `task_id` (string, required).
- `wiki` (string, required).
- `expected_updated` (string, required): OCC handle.
- `status` (status enum, optional).
- `notes` (string, optional).
- `segregation` (array of strings, optional).
- `agent_id` (string, optional).

**Returns:** Updated task summary.

**Errors:** OCC mismatch throws.

**Example:**
```json
{ "tool": "vault.task-update", "args": { "task_id": "task-refresh-syntheses", "wiki": "_meta", "expected_updated": "2026-05-12", "status": "completed" } }
```

**Source:** `src/tools/task-update.ts`

---

## Claims

### vault.claim

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
- `wiki` (string, optional): Destination wiki; falls back to `defaultWiki` then `_agents`.

**Returns:** `{ claim_id, action, superseded_id?, rejection?, reindex_recommended: true }`. `action` is one of `created | revalidated | superseded | retracted | rejected`.

**Errors:** `override/revalidate/retract` are mutually exclusive; `--reason is required for retraction`; only `authored_by` can retract; supersede on lower confidence returns `action: "rejected"` rather than throwing.

**Example:**
```json
{ "tool": "vault.claim", "args": { "key": "prefer-tdd-cycle-for-bugfixes", "title": "Prefer TDD for bugfixes", "as": "pidgey", "confidence": 0.8 } }
```

**Source:** `src/tools/claim.ts`

---

### vault.list-claims

Read-only claim listing with bucket filter, status filter, effective-confidence floor, sort by effective confidence desc. Falls back to a disk walk when `_index/claims.json` is missing.

**Params:**
- `by` (`"profile" | "move" | "tag" | "scope_wiki" | "global"`, optional): Bucket dimension.
- `value` (string, optional): Bucket value (required for non-global).
- `min_effective_confidence` (number 0..1, optional): Defaults to `render_min_confidence` config (0.4).
- `status` (array of `"active" | "superseded" | "retracted"`, default `["active"]`).
- `limit` (positive int, optional): Defaults to `render_default_limit` config (10).
- `wiki` (string, optional).

**Returns:** `{ claims: ClaimEntry[], total, index_age_seconds }`.

**Errors:** None routine.

**Example:**
```json
{ "tool": "vault.list-claims", "args": { "by": "profile", "value": "pidgey" } }
```

**Source:** `src/tools/list-claims.ts`

---

## Agent substrate

### vault.bootstrap-repo

Wire a repo to the vault MCP: writes `.mcp.json`, appends a CLAUDE.md fragment, optionally deploys a Pokemon's moveset.

**Params:**
- `repo_path` (string, required): Target repo absolute path.
- `wiki` (string, required): Wiki this repo's work belongs to.
- `pokemon` (string, optional): Profile id to deploy.
- `channels` (array of strings, optional): Channels to tail/post on.
- `mcp_server_name` (string, default `"vault"`): MCP server registration name.

**Returns:** `{ files_written, moveset_synced, channels_configured }`.

**Errors:** `PROFILE_NOT_FOUND: <id>` when `pokemon:` is set but the profile is missing.

**Example:**
```json
{ "tool": "vault.bootstrap-repo", "args": { "repo_path": "/abs/path/to/repo", "wiki": "_meta", "pokemon": "pidgey" } }
```

**Source:** `src/tools/bootstrap-repo.ts`

---

### vault.evolve-profile

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
{ "tool": "vault.evolve-profile", "args": { "pokemon_id": "profile-charmander", "commit": false } }
```

**Source:** `src/tools/evolve-profile.ts`

---

### vault.list-platform-profiles

List Stadium-registered profiles in the resolved wiki — the draft pool. Hydrates `real_skill_levels` from each move's SKILL.md.

**Params:**
- `wiki` (string, optional): Falls back to resolved trainer context.
- `owner_trainer_id` (string, optional, regex `^[0-9A-Z]{26}$`): Filter by ULID trainer.

**Returns:** `{ profiles: PlatformProfileRow[], caller_trainer_id }`.

**Errors:** `TrainerContextError` when neither `wiki:` nor trainer context resolves.

**Example:**
```json
{ "tool": "vault.list-platform-profiles", "args": {} }
```

**Source:** `src/tools/list-platform-profiles.ts`

---

### vault.profile-stats

Per-profile counts (tasks done/failed/in-flight, journals, channels, moves-used) plus next-evolution threshold. Reads `_index/profiles.json`.

**Params:**
- `pokemon_id` (string, required).
- `wiki` (string, optional): Falls back to resolved trainer context.

**Returns:** `{ profile_id, pokemon_type, evolution_stage, days_since_creation, tasks_completed, tasks_failed, tasks_in_flight, success_rate, journals_count, channels_active, moves_used_freq, next_evolution_threshold?, caller_trainer_id }`.

**Errors:** `PROFILE_NOT_FOUND: _index/profiles.json missing — run vault.reindex first` when the sidecar is absent.

**Example:**
```json
{ "tool": "vault.profile-stats", "args": { "pokemon_id": "profile-pidgey" } }
```

**Source:** `src/tools/profile-stats.ts`

---

### vault.refresh-profile-memory

Convenience wrapper around `vault.synthesize` with `by_agent` + `scope=memory`. Writes `wikis/_agents/synthesis/synthesis-<bare-name>-memory.md`. Idempotent.

**Params:**
- `pokemon_id` (string, required).
- `wiki` (string, optional): Falls back to resolved trainer context.

**Returns:** `{ memory_page_id, path, inputs_used_count, last_compiled, caller_trainer_id }`.

**Errors:** `ProfileNotFoundError` when the profile is missing at the resolved wiki path.

**Example:**
```json
{ "tool": "vault.refresh-profile-memory", "args": { "pokemon_id": "profile-pidgey" } }
```

**Source:** `src/tools/refresh-profile-memory.ts`

---

### vault.start

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
{ "tool": "vault.start", "args": { "wiki": "_meta", "pokemon": "pidgey" } }
```

**Source:** `src/tools/start.ts`

---

### vault.suggest-pokemon

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
{ "tool": "vault.suggest-pokemon", "args": { "dev_specialty": "backend", "limit": 3 } }
```

**Source:** `src/tools/suggest-pokemon.ts`

---

### vault.sync-agents

Deploy a Pokemon (or list, or `all: true`) as runtime subagent definitions in the target repo. Builds a `SubagentIntent` per profile, hands to the per-runtime adapter, writes `<target>/.claude/agents/<pokemon-id>.md` plus optional moveset SKILL.md files. Idempotent on `source_revision`.

**Params:**
- `target` (string, required): Target repo path.
- `runtime` (`"claude-code"`, default `"claude-code"`).
- `mode` (`"copy" | "symlink"`, default `"copy"`).
- `overwrite` (boolean, default `true`).
- `include_moveset` (boolean, default `true`).
- `continue_on_error` (boolean, default `false`): Halt-on-first-error by default.
- `pokemon` (string or string array, optional): Mutually exclusive with `all`.
- `all` (boolean, default `false`).
- `exclude` (array of strings, default `[]`): Only valid with `all: true`.
- `pokemon_type` (array of strings, default `[]`): Only valid with `all: true`.

**Returns:** `{ results: PerPokemonResult[], summary: { requested, deployed, skipped, failed } }`.

**Errors:** `pokemon and all are mutually exclusive`; `one of pokemon or all: true is required`; `exclude and pokemon_type are only valid with all: true`.

**Example:**
```json
{ "tool": "vault.sync-agents", "args": { "target": "/abs/path/repo", "pokemon": "pidgey" } }
```

**Source:** `src/tools/sync-agents.ts`

---

### vault.sync-skills

Deploy a Pokemon's moveset into a target repo's local skills directory. With `reverify: true`, scans existing deployments for drift instead of deploying.

**Params:**
- `repo_path` (string, required).
- `pokemon` (string, optional): Required unless `reverify: true` or `all: true`.
- `all` (boolean, default `false`): Deploy every matching profile; mutually exclusive with `pokemon`.
- `exclude` (array of strings, default `[]`).
- `pokemon_type` (array of strings, default `[]`).
- `target` (`"claude-code" | "openclaw" | "codex"`, default `"claude-code"`).
- `mode` (`"copy" | "symlink"`, default `"symlink"`).
- `reverify` (boolean, default `false`): Scan deployments for drift.
- `fix` (boolean, default `false`): Re-deploy drifted moves; requires `reverify: true`.
- `continue_on_error` (boolean, default `false`).

**Returns:** Single-pokemon flat shape `{ skills_dir, moves_synced, moves_skipped_unsupported }`; multi-profile envelope `{ results, summary }`; reverify shape `{ drift, drift_fixed }`.

**Errors:** `pokemon and all are mutually exclusive`; `deploy mode requires pokemon or all: true`; `fix: true requires reverify: true`.

**Example:**
```json
{ "tool": "vault.sync-skills", "args": { "repo_path": "/abs/path/repo", "pokemon": "pidgey" } }
```

**Source:** `src/tools/sync-skills.ts`

---

## Sync primitives

### vault.wait-for

Wait for the next event matching `filter`. Returns immediately if `since` cursor reveals a matching event.

**Params:**
- `filter` (object, required): `{ source, wiki?, channel?, id? }`.
- `since` (string, optional): Prior cursor (ISO with seq).
- `timeout_ms` (positive int, max 120000, default `25000`).

**Returns:** `{ events, cursor, timed_out }`.

**Errors:** None routine; max timeout is 120s.

**Example:**
```json
{ "tool": "vault.wait-for", "args": { "filter": { "source": "vault.channel-post", "channel": "stoa-progress" } } }
```

**Source:** `src/tools/wait-for.ts`

---

### vault.wait-for-all

Wait until every filter has been satisfied (fan-in).

**Params:**
- `filters` (array of filter objects, required, min 1 max 32).
- `since` (string, optional).
- `timeout_ms` (positive int, max 120000, default `25000`).

**Returns:** `{ events, cursor, timed_out }`.

**Errors:** Array length out-of-range fails Zod.

**Example:**
```json
{ "tool": "vault.wait-for-all", "args": { "filters": [{ "source": "vault.task-update", "id": "task-a" }, { "source": "vault.task-update", "id": "task-b" }] } }
```

**Source:** `src/tools/wait-for-all.ts`

---

### vault.wait-for-any

Wait for the first event matching any filter (first-of-N).

**Params:** Same as `wait-for-all`.

**Returns:** `{ events, cursor, timed_out }`.

**Errors:** Same as `wait-for-all`.

**Example:**
```json
{ "tool": "vault.wait-for-any", "args": { "filters": [{ "source": "vault.match-watch" }, { "source": "vault.channel-post", "channel": "stadium-alerts" }] } }
```

**Source:** `src/tools/wait-for-any.ts`

---

### vault.wait-for-many

Collect up to `max` events matching `filter` (bounded batch).

**Params:**
- `filter` (object, required).
- `max` (positive int, max 1000, required).
- `since` (string, optional).
- `timeout_ms` (positive int, max 120000, default `25000`).

**Returns:** `{ events, cursor, timed_out }`.

**Errors:** Zod range failures.

**Example:**
```json
{ "tool": "vault.wait-for-many", "args": { "filter": { "source": "vault.agent-journal" }, "max": 50 } }
```

**Source:** `src/tools/wait-for-many.ts`

---

## Stadium

All Stadium tools authenticate via `resolveStadiumConfig` and require an active trainer context (see top of file). Server errors propagate as `StadiumApiError`; callers see the platform's `error_code` directly.

### vault.list-invites

List pending match invites for the calling trainer.

**Params:** None.

**Returns:** Platform `listInvites` response.

**Errors:** `StadiumApiError`.

**Example:**
```json
{ "tool": "vault.list-invites", "args": {} }
```

**Source:** `src/tools/list-invites.ts`

---

### vault.match-watch

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
{ "tool": "vault.match-watch", "args": { "match_id": "01H..." } }
```

**Source:** `src/tools/match-watch.ts`

---

### vault.move-fuse

Fuse a canonical PokeAPI move with a registered real-skill into a usable `move_id`.

**Params:**
- `canonical_move_name` (string, required, regex `^[a-z0-9-]+$`).
- `real_skill_id` (string, required, min 1).

**Returns:** `{ move_id }`.

**Errors:** `StadiumApiError`.

**Example:**
```json
{ "tool": "vault.move-fuse", "args": { "canonical_move_name": "ember", "real_skill_id": "rs_..." } }
```

**Source:** `src/tools/move-fuse.ts`

---

### vault.profile-register

Register a profile with the Stadium platform; persist `platform_profile_id` + `platform_stats` back to the file.

**Params:**
- `profile_id` (string, required, regex `^profile-`).
- `wiki` (string, optional): Falls back to resolved trainer context.

**Returns:** `{ profile_id, stats, caller_trainer_id }`.

**Errors:** `profile <id> missing 'pokemon' field`; type check on `pokemon`; `TrainerContextError` when wiki cannot be resolved; `StadiumApiError`.

**Example:**
```json
{ "tool": "vault.profile-register", "args": { "profile_id": "profile-pidgey" } }
```

**Source:** `src/tools/profile-register.ts`

---

### vault.real-skill-refresh

Re-derive a registered real-skill's modifier function from the current SKILL.md content.

**Params:**
- `skill_id` (string, required, regex `^move-`).
- `wiki` (string, optional).

**Returns:** `{ real_skill_id, modifier_function }`.

**Errors:** `<id> has no real_skill_id — register first via vault.real-skill-register`; `StadiumApiError`.

**Example:**
```json
{ "tool": "vault.real-skill-refresh", "args": { "skill_id": "move-tdd-cycle" } }
```

**Source:** `src/tools/real-skill-refresh.ts`

---

### vault.real-skill-register

Register a real-skill (`move-*/SKILL.md`) with Stadium; persist returned `real_skill_id` + advisory `combat:` block.

**Params:**
- `skill_id` (string, required, regex `^move-`).
- `wiki` (string, optional).

**Returns:** `{ real_skill_id, modifier_function }`.

**Errors:** `StadiumApiError` (`modifier_clamped`, `derivation_failed`, etc.); `WikiRequiredError`.

**Example:**
```json
{ "tool": "vault.real-skill-register", "args": { "skill_id": "move-tdd-cycle" } }
```

**Source:** `src/tools/real-skill-register.ts`

---

### vault.telemetry-push

Push a move-usage event to Stadium; increments server-side XP for the named real-skill.

**Params:**
- `real_skill_id` (string, required, min 1).
- `source` (string, required, min 1).
- `reference_link` (string, required, min 1).

**Returns:** Platform `pushTelemetry` response.

**Errors:** `StadiumApiError` (`unknown_real_skill_id`, `rate_limited`, etc.).

**Example:**
```json
{ "tool": "vault.telemetry-push", "args": { "real_skill_id": "rs_...", "source": "journal-...", "reference_link": "https://..." } }
```

**Source:** `src/tools/telemetry-push.ts`

---

### vault.trainer-accept-match

Accept a `pending_invite` match; transitions to drafting.

**Params:**
- `match_id` (string, required, min 1).
- `wiki` (string, optional, min 1).

**Returns:** Platform response merged with `{ caller_trainer_id, resolved_wiki }`.

**Errors:** `TrainerContextError`; `StadiumApiError`.

**Example:**
```json
{ "tool": "vault.trainer-accept-match", "args": { "match_id": "01H..." } }
```

**Source:** `src/tools/trainer-accept-match.ts`

---

### vault.trainer-get-state

Fetch authenticated match state; supports `since_turn` for incremental polling. During the drafting phase, also returns `available_profiles` (the caller's draft pool).

**Params:**
- `match_id` (string, required, min 1).
- `since_turn` (non-negative int, optional).

**Returns:** Platform state extended with `{ caller_trainer_id, caller_side, waiting_for_move, available_profiles? }`.

**Errors:** `caller is not a participant in this match`; `getMatchState: unexpected non-object response`; `TrainerContextError`.

**Example:**
```json
{ "tool": "vault.trainer-get-state", "args": { "match_id": "01H..." } }
```

**Source:** `src/tools/trainer-get-state.ts`

---

### vault.trainer-init

Validate the configured Stadium API key and scaffold `wikis/_agents/trainers/trainer-<slug>.md` with the initial strategy seed.

**Params:**
- `name` (string, required, min 1).
- `strategy` (string, optional, min 1).

**Returns:** `{ id, path, trainer_id, caller_trainer_id }`.

**Errors:** `StadiumApiError` if API key validation fails; `TRAINER_WIKI_UNSET` propagates (other trainer-context errors are swallowed because init is the bootstrapping path).

**Example:**
```json
{ "tool": "vault.trainer-init", "args": { "name": "Brett" } }
```

**Source:** `src/tools/trainer-init.ts`

---

### vault.trainer-queue-match

Create a match invite against an opponent trainer; returns `match_id` in `pending_invite` state.

**Params:**
- `opponent_trainer_id` (string, required, min 1).
- `ruleset` (`"standard"`, default `"standard"`).
- `wiki` (string, optional, min 1).

**Returns:** Platform response merged with `{ caller_trainer_id, resolved_wiki }`.

**Errors:** `TrainerContextError` when wiki cannot be resolved; `StadiumApiError`.

**Example:**
```json
{ "tool": "vault.trainer-queue-match", "args": { "opponent_trainer_id": "trainer-foo" } }
```

**Source:** `src/tools/trainer-queue-match.ts`

---

### vault.trainer-submit-draft

Submit 6 picks (platform_profile_ids as ULIDs) during a match's drafting phase.

**Params:**
- `match_id` (string, required, regex `^[0-9A-Z]{26}$`).
- `picks` (array of strings, required, length exactly 6, each regex `^[0-9A-Z]{26}$`).

**Returns:** Platform response merged with `{ caller_trainer_id }`.

**Errors:** `InvalidPicksShapeError` (`INVALID_PICKS_SHAPE`) on any Zod failure (wraps the ZodError); `StadiumApiError`.

**Example:**
```json
{ "tool": "vault.trainer-submit-draft", "args": { "match_id": "01H...", "picks": ["01H...","01H...","01H...","01H...","01H...","01H..."] } }
```

**Source:** `src/tools/trainer-submit-draft.ts`

---

### vault.trainer-submit-move

Submit a move for the current turn; the server resolves the turn once both trainers submit.

**Params:**
- `match_id` (string, required, min 1).
- `turn` (non-negative int, required).
- `move_id` (string, required, min 1).
- `target` (string, optional).

**Returns:** Platform response merged with `{ caller_trainer_id }`.

**Errors:** `submitMove: unexpected non-object response`; `StadiumApiError`.

**Example:**
```json
{ "tool": "vault.trainer-submit-move", "args": { "match_id": "01H...", "turn": 3, "move_id": "ember-rs_..." } }
```

**Source:** `src/tools/trainer-submit-move.ts`

---

## Misc

### vault.merge-queue

Surface the bulk merge queue for a coordination channel: ready PRs parsed from `ready: branch=...` journal signals, unready tasks, and a topo-sorted dependency order keyed by `task.blocking`. Pure read; `ci_status` is always `"unknown"`.

**Params:**
- `channel` (string, required).
- `wiki` (string, optional).
- `family` (string, optional).
- `since` (string, optional, ISO datetime): Defaults to 7 days ago.

**Returns:** `MergeQueueOutput` (ready_prs, unready_prs, ordered, etc.).

**Errors:** None routine; family/wiki resolution may yield an empty queue.

**Example:**
```json
{ "tool": "vault.merge-queue", "args": { "channel": "stoa-progress" } }
```

**Source:** `src/tools/merge-queue.ts`

---

### vault.merge-record

Record a merge outcome for a PR: write a journal entry under `wikis/_agents/journal/`, and when `status === "merged"` with a `task_id`, transition the source task to `completed`. Halt/fail statuses write the journal but do NOT touch the task. `agent_id` is alias-resolved.

**Params:**
- `pr_number` (int, required).
- `channel` (string, required).
- `agent_id` (string, required): Bare or `agent:<bare>` or `profile-<bare>`.
- `merge_commit_sha` (string, optional).
- `status` (`"merged" | "failed" | "halted-conflict" | "halted-red-ci"`, required).
- `notes` (string, optional).
- `task_id` (string, optional).

**Returns:** `{ journal_id, recorded_at, task_updated }`.

**Errors:** `UnknownAgentError` when `agent_id` cannot be resolved to a profile (no journal written); missing task surfaces as `task_updated: false` silently.

**Example:**
```json
{ "tool": "vault.merge-record", "args": { "pr_number": 42, "channel": "stoa-progress", "agent_id": "pidgey", "status": "merged", "task_id": "task-ship-doc" } }
```

**Source:** `src/tools/merge-record.ts`

---

### vault.rewrite-links

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
{ "tool": "vault.rewrite-links", "args": { "from_prefix": "wikis/old-name/", "to_prefix": "wikis/new-name/", "dry_run": true } }
```

**Source:** `src/tools/rewrite-links.ts`
