# Changelog

## 0.2.1 — 2026-05-19

### Fixed

- **Missing runtime dependency.** `picomatch` is imported directly by the event-bus watcher (`src/core/eventbus/watcher.ts`) but was only present as a transitive dev dependency in 0.2.0. Installing via npm into a clean tree produced `ERR_MODULE_NOT_FOUND: Cannot find package 'picomatch'` when any code path touched the watcher. Now declared as a runtime dependency.

## 0.2.0 — 2026-05-19

First substantial release after the initial publish. 117 commits, several new subsystems.

### Added

- **Event bus + wait-for tools.** Chokidar-backed file watcher, EventBus with snapshot-based fan-out, WaiterRegistry, and four new MCP tools — `vault.wait-for`, `vault.wait-for-any`, `vault.wait-for-all`, `vault.wait-for-many` — for cross-process coordination. Subscribe-before-scan semantics with dedup. See `docs/wait-for.md`.
- **Dashboard UI.** New `stoa ui` subcommand boots a local web dashboard. Three-pane Alpine.js frontend covering tasks, agents, channels. Includes a watchdog ribbon for stuck tasks, staleness rail for overdue syntheses, spawn-agent modal wired to suggest/register, sprite SVG route, URL-hash persistence for pinned views, and CSRF origin-check middleware on write routes.
- **Agent memory.** New `vault.agent-memory` MCP tool + `stoa agent-memory` CLI command. Rank, filter, and `--task` scope derivation. Surfaces past entries scoped to a profile or task.
- **Task-readiness gate.** `vault.task-claim` now refuses to claim a task whose body is not ready; a `force` param overrides. New `task-not-ready` lint rule surfaces violations.
- **Recall filter.** `vault.recall` accepts an optional `filter` expression — pure parser + evaluator over frontmatter fields with comparators.
- **Sync `--all` flag.** Both `sync-skills` and `sync-agents` now accept `--all` with `--exclude` and `--type` / `--pokemon` filters. New `stoa sync-agents` CLI subcommand mirrors the existing `sync-skills`.
- **Task release.** `releaseTask` transitions a claimed task back to pending via mtime OCC; exposed at `POST /api/tasks/:id/release`.
- **`list-claims` by authored_by.** `by=authored_by` bucket added to `vault.list-claims`.
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
