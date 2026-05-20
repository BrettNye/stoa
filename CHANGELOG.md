# Changelog

## 0.3.0 — 2026-05-19

Specialist agent substrate (v1.9 DAG, 15 tasks). Lets agents develop deep domain competence — through wiki-local move overlays and curricular-claim cold-start — without breaking the portable-moves contract.

### Added

- **`source_type:` on claims.** New optional frontmatter field on `claim` pages: `lived | curricular | retro`, default `lived`. `lived` cites real journal/task/PR evidence; `curricular` cites a course `guide-course-*` page; `retro` cites older artifacts a pattern was extracted from. Absent field is treated as `lived` — no migration needed.
- **`vault.claim --source-type=` parameter.** Authoring surface for the new field on `vault.claim`. Validates against the fixed value set; rejects others.
- **`vault.list-claims --source-type=` filter.** Read-side filter on the MCP tool. Parallels the existing `by=profile | move | tag | scope_wiki | global` bucket dimensions.
- **Wiki-local moves convention.** Moves under `wikis/<wiki>/moves/<id>/SKILL.md` (non-`_agents`) declare a required `scope_wiki:` field that must match the parent folder wiki. Portable moves continue to live at `wikis/_agents/moves/<id>/SKILL.md` and must NOT carry `scope_wiki:`.
- **Wiki-local move layering at deploy time.** `vault.bootstrap-repo` and `vault.sync-skills` now overlay every `wikis/<wiki>/moves/<id>/SKILL.md` onto the resolved profile's portable moveset when a wiki is passed through. The deployed CLAUDE.md fragment renders distinct `### Portable moves` and `### Specialist moves (<wiki>)` subsections; portable wins on id collision (with a lint warning).
- **`vault.bootstrap-repo --wiki=` CLI flag.** Exposes wiki-local move layering at the CLI surface. (The `sync-skills` CLI subcommand does not currently surface `--wiki=` — use `bootstrap-repo --wiki=` from the terminal, or invoke `vault.sync-skills` directly via the MCP tool.)
- **`_index/claims.json` `schema_version: 3`.** Adds a `by_source_type` bucket with `lived`, `curricular`, `retro` arrays of claim ids. Readers tolerate `1 | 2 | 3` for back-compat; writers emit `3` going forward.
- **Source-type weights in `evolve-profile`.** The claim-cluster pass now weights claims by source type when summing cluster weight for specialty identification: `lived: 1.0`, `curricular: 0.5`, `retro: 0.7`. Configurable via `_agents/CLAUDE.md` (`source_type_weights:` block). The base eligibility gate (tasks_completed + success_rate) is unchanged — weighting affects rationale and moveset suggestions only, not yes/no stage-up.
- **`vault.agent-memory` source-type tags.** Each returned claim gains three new fields: `source_type` (raw value), `source_type_tag` (e.g. `"[curricular | 0.62]"`), and `rendered` (the canonical agent-facing string `[<source_type> | <conf>] <body>`). Ranking is unchanged — the tag is informational, not load-bearing for retrieval.
- **Lint rules.** Five new lint codes: `CLAIM_SOURCE_TYPE_INVALID` (error — claim has `source_type:` outside the fixed value set), `MOVE_SCOPE_WIKI_FOLDER_MISMATCH` (error — `scope_wiki:` does not match the parent folder), `MOVE_SCOPE_WIKI_MISSING` (warning — wiki-local move missing required `scope_wiki:`), `MOVE_PORTABLE_HAS_SCOPE` (warning — portable move erroneously carries `scope_wiki:`), `MOVE_ID_SHADOWS_PORTABLE` (warning — wiki-local move id collides with a portable move id; portable wins at deploy time).

### Docs

- `docs/agent-memory.md` deep-dive extended with `source_type` / `source_type_tag` / `rendered` field shapes and the unchanged-ranking note.
- `docs/tool-reference.md` updated for `vault.claim`, `vault.list-claims`, `vault.bootstrap-repo`, `vault.sync-skills`, `vault.agent-memory`.
- `docs/common-workflows.md` gains a cold-start onboarding workflow covering course-authoring → curricular bootstrap → lived-claim convergence.

## 0.2.1 — 2026-05-19

### Fixed

- **Missing runtime dependency.** `picomatch` is imported directly by the event-bus watcher (`src/core/eventbus/watcher.ts`) but was only present as a transitive dev dependency in 0.2.0. Installing via npm into a clean tree produced `ERR_MODULE_NOT_FOUND: Cannot find package 'picomatch'` when any code path touched the watcher. Now declared as a runtime dependency.

## 0.2.0 — 2026-05-19

First substantial release after the initial publish. 117 commits, several new subsystems.

### Added

- **Event bus + wait-for tools.** Chokidar-backed file watcher, EventBus with snapshot-based fan-out, WaiterRegistry, and four new MCP tools — `vault_wait-for`, `vault_wait-for-any`, `vault_wait-for-all`, `vault_wait-for-many` — for cross-process coordination. Subscribe-before-scan semantics with dedup. See `docs/wait-for.md`.
- **Dashboard UI.** New `stoa ui` subcommand boots a local web dashboard. Three-pane Alpine.js frontend covering tasks, agents, channels. Includes a watchdog ribbon for stuck tasks, staleness rail for overdue syntheses, spawn-agent modal wired to suggest/register, sprite SVG route, URL-hash persistence for pinned views, and CSRF origin-check middleware on write routes.
- **Agent memory.** New `vault_agent-memory` MCP tool + `stoa agent-memory` CLI command. Rank, filter, and `--task` scope derivation. Surfaces past entries scoped to a profile or task.
- **Task-readiness gate.** `vault_task-claim` now refuses to claim a task whose body is not ready; a `force` param overrides. New `task-not-ready` lint rule surfaces violations.
- **Recall filter.** `vault_recall` accepts an optional `filter` expression — pure parser + evaluator over frontmatter fields with comparators.
- **Sync `--all` flag.** Both `sync-skills` and `sync-agents` now accept `--all` with `--exclude` and `--type` / `--pokemon` filters. New `stoa sync-agents` CLI subcommand mirrors the existing `sync-skills`.
- **Task release.** `releaseTask` transitions a claimed task back to pending via mtime OCC; exposed at `POST /api/tasks/:id/release`.
- **`list-claims` by authored_by.** `by=authored_by` bucket added to `vault_list-claims`.
- **Lint rules.** `claim-scope-wiki-nonexistent`, `task-not-ready`, `SYNTHESIS_DEBT`, `MISSING_CURATION_PRIORITY` (with new `curation_priority` frontmatter field).
- **Sprite SVG output.** New `GET /api/sprites/:bareName.svg` route alongside refactored `decodeSpriteGrid`.

### Changed

- **Build is mandatory before publish.** `prepublishOnly` hook now runs `npm run build` so `dist/` is never stale on publish.
- **CI builds before tests.** Test suite now depends on compiled `dist/`.
- **Profile field normalization.** `claim` field accepts `agent:` and `profile-` prefixes interchangeably.
- **`refresh-profile-memory`.** Renamed `pokemon_id` → `agent_id`.

### Fixed

- `--task` scope derivation in `agent-memory`.
- `sync-agents` zod schema flattened for MCP JSON Schema compatibility.
- `releaseTask` deletes `assigned_at` (not `claimed_at`).
- Stadium registration is now best-effort on `POST /api/agents`.
- Watcher race: in-flight watcher closed before ready.
- Global-install path bugs — `relativeToCwd()` replaced with `path.relative()`.
- Numerous CI/test/lint stabilizations to unblock the build pipeline.

### Docs

- Installation rewrite for end users (npm-first, generic paths).
- Quickstart, common-workflows, tool-reference guides.
- Dashboard section in README.
- Agent-memory + task-coordination protocol references.
- Wait-for developer guide.
- Claude Desktop (Cowork) connection recipe.

## 0.1.0 — 2026-05-05

Initial publish.
