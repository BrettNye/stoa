# Changelog

## 0.5.0 — 2026-06-15

Tool-surface family consolidation. 19 tool names retire; 8 consolidated names take their place. The advertised surface drops from 55 → 43 tools.

### Changed (BREAKING) — 8 tool-family consolidations

Each family now exposes a single tool name that accepts a `mode:` (or `surface:`) discriminator instead of a separate tool per operation.

| Retired names | Consolidated name | Discriminator |
|---|---|---|
| `vault_wait-for-any`, `vault_wait-for-all`, `vault_wait-for-many` | `vault_wait-for` | `mode: next\|any\|all\|many` |
| `vault_trainer-submit-draft`, `vault_trainer-submit-move` | `vault_trainer-submit` | `mode: draft\|move` |
| `vault_merge-queue`, `vault_merge-record` | `vault_merge` | `mode: queue\|record` |
| `vault_list-invites`, `vault_list-platform-profiles` | `vault_stadium-list` | `mode: invites\|platform-profiles` |
| `vault_task-create`, `vault_task-list`, `vault_task-update`, `vault_task-claim` | `vault_task` | `mode: create\|list\|update\|claim` |
| `vault_channel-post`, `vault_channel-tail` | `vault_channel` | `mode: post\|tail` |
| `vault_real-skill-register`, `vault_real-skill-refresh` | `vault_real-skill` | `mode: register\|refresh` |
| `vault_sync-skills`, `vault_sync-agents` | `vault_sync` | `surface: skills\|agents` |

**Migration.** Replace every call site: drop the old name, use the consolidated name, and add the appropriate `mode:` or `surface:` field. E.g. `vault_task-create { ... }` → `vault_task { mode: "create", ... }`.

## 0.4.0 — 2026-05-26

Server mode. Networked HTTP transport with JWT-based bearer auth and capability scoping. Lets operators run Stoa as a hosted MCP endpoint reachable from dispatched workers (Fargate tasks, Agora-dispatched sub-agents, CI fleets) without sharing a process boundary with Stoa. Solo-laptop `stoa --mcp` stdio mode continues to work unchanged. Full deployment walkthrough at `docs/server-mode.md`; design rationale at `docs/superpowers/specs/2026-05-21-stoa-server-mode-design.md`.

### Added — transport + CLI

- **`stoa serve [--bind=HOST:PORT] [--vault=PATH]`** — boots the HTTP MCP server. Hono + MCP `StreamableHTTPServerTransport` in stateful mode. `/health` endpoint returns 200 + `{ status, vault, version }` when the vault path is readable; 503 otherwise. Bind defaults to `127.0.0.1:8443`.
- **`stoa mint-token --agent-id=X --scope=Y[,Z] --ttl=30m`** — HS256 JWT signer for testing and operator-token bootstrap. Reads `STOA_TOKEN_SIGNING_SECRET` from env; never round-trips through Stoa. Defaults `--ttl=30m`.
- **`stoa init -y`** — non-interactive init for Docker / CI bootstrap. Reads `STOA_VAULT_PATH`, `STOA_THEME`, `STOA_DEFAULT_WIKI` from env. Idempotent on existing vaults.
- **`vault_lint --scope=full`** — whole-vault lint pass (admin-only over HTTP). Default `per-wiki` scope is unrestricted.
- **Docker image** at `ghcr.io/brettnye/stoa:0.4.0`. Multi-stage `node:20-slim` build; CMD `serve --bind=0.0.0.0:8443`. `.dockerignore` excludes worktrees, tests, dev artifacts.

### Added — auth model

- **HS256 JWTs**, integrator-minted, Stoa verifier-only. No token issuance endpoint. Signing secret in `STOA_TOKEN_SIGNING_SECRET` env var, shared between Stoa and the orchestrator. RS256 / JWKS is the path of record; HMAC only in v0.4.
- **Bearer tokens** carry `sub` (becomes `Principal.agent_id`), `scopes`, `exp`, `iat`, `jti`. Verified once at MCP session `initialize`; principal binds to the session for subsequent tool calls.
- **Hono bearer middleware** on `/mcp` — extracts the token, calls the injected `TokenVerifier`, attaches the `Principal` to the Hono context. 401 + `WWW-Authenticate` headers per RFC 6750 on failures.
- **`Principal` shape**: `{ agent_id, scopes, exp?, source: "stdio" | "http" }`. Stdio principals resolve from env → vault `.stoa/identity` → OS username → `"stoa-local"`, always carrying `*:*` scopes.

### Added — capability scoping

- **Hybrid scope grammar**: closed tool-prefix + open `picomatch` glob over a per-tool axis. Examples: `vault_recall:wikis/project-acme/**`, `vault_task-claim:tasks/review-abc`, `vault_channel-post:channels/build-coord`.
- **Three-gate dispatcher** (`src/auth/dispatcher.ts`) per tool call: `httpForbidden` → `admin` → `axis`. Used identically by stdio and HTTP dispatchers — DRY chokepoint shared by both transports.
- **`ToolScope` metadata** on every one of the 53 tools — declares `axis: (input) => string`, optional `adminOnly: (input) => boolean`, optional `httpForbidden: true`.
- **Stdio principals** carry `*:*` scope and pass every gate automatically. HTTP tokens are subject to all three gates.
- **Admin-required tools** (refuse HTTP without `admin:*` or `admin:<tool>` scope): `vault_reindex`, `vault_evolve-profile`, `vault_set-active`, `vault_new-wiki`, map writes via `vault_new --type=map`, `vault_lint --scope=full`.
- **HTTP-forbidden tools** (refuse HTTP regardless of scopes): `vault_sync-skills`, `vault_sync-agents`, `vault_bootstrap-repo`, `vault_seed-substrate`. Stdio-only.

### Added — concurrency

- **Per-task locking** in `vault_task-claim`. `claimTask` is now `async` and wraps its read-check-write in `withSerializedIndexWrite([\`task-${input.task_id}\`], ...)`. Closes the documented same-day race where two concurrent claimants could both pass the frontmatter-date OCC and double-claim — exactly one fulfills, the other rejects with `AlreadyClaimedError`.
- **Stale-lock detection** on lock acquisition: 60s threshold via `statSync(lockPath).mtimeMs`, capped at 3 stale-unlink retries per lock to bound the loop under adversarial mtime (clock skew, antivirus interruption, crashed writers). Race-safe unlink. Replaces the failure mode where five zero-byte locks from a crashed process once blocked every subsequent write.

### Added — vault config

`.stoa/config.json` at vault root carries:

- `theme: "pokemon" | "plain"` — affects scaffolding and dashboard UX only, not enforcement. Default `pokemon`.
- `identity: { default_agent_id: "..." }` — fallback for stdio `Principal`.
- `auth: { signing_secret_env: "STOA_TOKEN_SIGNING_SECRET", issuer_hint: "..." }` — env-var name for the signing secret; informational `iss` hint.
- `bind: "127.0.0.1:8443"` — HTTP server bind address. Overridable with `stoa serve --bind=...`.

Missing file → all defaults. Partial config merges over defaults at the key level. Malformed JSON falls back to defaults without throwing.

### Changed (BREAKING)

- **`agent_id` removed from tool input schemas** on: `vault_channel-post`, `vault_agent-journal`, `vault_task-claim`, `vault_task-update`, `vault_task-create`, `vault_claim` (`authored_by` also dropped — retract authorization now compares against `ctx.principal.agent_id`), `vault_agent-memory`. Server now stamps `agent_id` from the verified principal. Callers passing `agent_id` will fail Zod parse with a clear error.
- **Migration**: run `stoa lint` and look for `AGENT_ID_INPUT_LEAK` warnings. For each call site, move `agent_id` from the tool input to `ctx.principal: { agent_id: "..." }`.
- **`claimTask` is now `async`.** Existing tool-handler callers already `await` it; direct importers of the core function need to add `await`.

### Added — lint code

- **`AGENT_ID_INPUT_LEAK`** (warning) — caller code passes `agent_id` to a write tool whose schema no longer accepts it. Locates within a 200-char window of the tool name. Scans `.ts` and `.md` files.

### Security

- Audit trail is now structurally truthful: `agent_id` cannot be self-asserted over HTTP. The server stamps it from the JWT `sub` claim, which the client cannot forge without the signing secret.
- Map writes require `admin:*` over HTTP — `map.md` files are curation, not dispatch.
- Substrate-scaffolding tools are HTTP-forbidden — they write to consuming repos' filesystems and don't make sense over the wire.

### Fixed

- **Stale-lockfile failure mode** in `withSerializedIndexWrite` (orphaned `.lock` files from crashed writers no longer block all subsequent writes).
- **`bin.ts` parseConfig vault-required check** now bypasses for `serve` and `mint-token` subcommands that handle their own vault resolution (or don't need a vault at all). The `cliArgv` filter also stops stripping `--vault=` when a self-configuring subcommand is in play.
- **`vitest.config.ts` `include` pattern** now covers co-located `src/**/*.test.ts` files alongside the existing `tests/` tree.

### Docs

- New `docs/server-mode.md` — operator deployment guide (~350 lines) covering install artifact, persistent storage, TLS posture, network reachability, day-zero install, Fargate task definition sketch, local dev recipe, two-tier credential pattern, per-dispatch flow, migration from stdio, health check, and a troubleshooting section that covers the common Windows / Git Bash path-conversion gotchas, secret-mismatch pitfalls, scope-denial diagnostics, and Docker layer caching.
- Updated `docs/task-coordination.md` "Concurrency" section to describe the new lock-based mutual exclusion (replaces the day-granular OCC admission).
- New design spec at `docs/superpowers/specs/2026-05-21-stoa-server-mode-design.md` and DAG plan at `docs/superpowers/plans/2026-05-21-stoa-server-mode-dag.md`.
- README `## Server mode (v0.4+)` section and a detailed `## v0.4 — server mode` release section, parallel to the v0.3 entry.

## 0.3.0 — 2026-05-21

Two feature sets ship together in this release: the specialist agent substrate (v1.9 DAG, 15 tasks) and new-user onboarding (4-wave DAG, 14 tasks). The substrate lets agents develop deep domain competence — through wiki-local move overlays and curricular-claim cold-start — without breaking the portable-moves contract. The onboarding stack turns "I installed Stoa and now what?" into a single `stoa onboard` command that detects clients, writes config, seeds a vault, and installs an AI-primer at the user's `~/.claude/CLAUDE.md` so their AI knows what to do with the new tools.

### Added — specialist agent substrate

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

### Added — new-user onboarding

- **`stoa onboard` CLI command.** Single command that orchestrates first-time setup — detects installed AI clients (Claude Code in v1), runs a 5-question interview (team-vs-solo, role, work surfaces, filing mode, what to remember between sessions), writes the MCP server entry into `~/.claude/settings.json`, installs the AI-primer at `~/.claude/CLAUDE.md`, seeds wikis at the chosen vault path with starter `map.md` and inbox items, and writes per-user state to `<vault>/_index/onboarding.json`. Replaces the old "edit settings.json yourself, then guess" flow with a self-verifying handoff prompt at the end.
- **`stoa onboard --diagnose` subcommand.** Read-only diagnostic that prints one line per check (AI-primer present, MCP entry registered, vault path writable) with ✓/✗ + a one-line fix instruction for each failure. Vault-path check uses a real write-probe rather than POSIX `accessSync(W_OK)` so it works correctly on Windows ACL-backed directories.
- **`stoa orient` CLI command + `vault_orient` MCP tool.** State-aware next-best-action classifier. Reads `_index/onboarding.json`, inbox volume across wikis, and synthesis `last_compiled` dates; returns `{ next_best_action, reasoning, tool_to_call?, suggestion_to_user? }`. Priority order: onboarding-incomplete → inbox-overflow (≥5) → stale-synthesis (>60d) → recall-question regex → steady-state. Tool exposed as `vault_orient` for in-session AI use; CLI mirror for human inspection.
- **AI-primer template.** Marker-bounded (`<!-- stoa-primer:start --> ... <!-- /stoa-primer -->`) CLAUDE.md fragment installed at user scope so every AI session — in any repo on the machine — knows about the vault and its reflex rules. Templated by interview answers: role-specific tag suggestions, passive-vs-active filing discipline, optional team-etiquette block. Idempotent rewrite finds and replaces the existing block; appends fresh when absent. Surrounding CLAUDE.md content untouched.
- **Per-wiki CLAUDE.md generation.** `buildWikiClaudemdPrompt` constructs the prompt sent to the user's connected AI for generating per-wiki conventions from a free-text workflow description; `fallbackWikiClaudemd` is the stub written when the AI declines. The 11-type schema is global but the *interpretation* (recipe vs account vs system component) is per-wiki — this is how that interpretation gets seeded.
- **Cross-platform client + sync-folder detection.** `detectClients(home, platform)` finds installed AI clients at canonical paths (`~/.claude`, `~/.cursor`, `~/.config/codex`); only Claude Code is wired into `stoa onboard` in v1. `detectSyncFolders(home, platform)` lists Dropbox / OneDrive / Google Drive / iCloud Drive / Box plus the OneDrive-Business `<Tenant>` variant via `readdirSync`. The `platform` parameter is currently unread — reserved for future per-OS path gating; documented inline.
- **`vault_orient` MCP tool registered.** `allTools` now exports 54 tools (was 53). Tool registry guard tests updated.

### Docs

- `docs/agent-memory.md` deep-dive extended with `source_type` / `source_type_tag` / `rendered` field shapes and the unchanged-ranking note.
- `docs/tool-reference.md` updated for `vault.claim`, `vault.list-claims`, `vault.bootstrap-repo`, `vault.sync-skills`, `vault.agent-memory`.
- `docs/common-workflows.md` gains a cold-start onboarding workflow covering course-authoring → curricular bootstrap → lived-claim convergence.
- Onboarding spec at `wikis/_meta/specs/2026-05-20-stoa-onboarding-design.md` (Knowledge repo) and DAG plan at `wikis/_meta/plans/2026-05-20-stoa-onboarding-dag.md` are the canonical references for the new-user surfaces.

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
