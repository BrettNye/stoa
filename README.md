# Stoa

> Persistent shared memory for AI coding agents.
> Your sessions stop forgetting things across days, repos, and machines.

[![npm version](https://img.shields.io/npm/v/@stoa-mcp/cli)](https://www.npmjs.com/package/@stoa-mcp/cli)
[![License: FSL-1.1-MIT](https://img.shields.io/badge/license-FSL--1.1--MIT-blue)](LICENSE)

**The pain it solves.** Every new AI chat session starts blank. You re-explain the same context, re-derive the same conclusions, re-justify the same decisions. Six months from now you'll spec the same thing for the fourth time because nobody — you or the AI — remembers the prior three.

**What it is.** An MCP server that turns a folder of markdown files on your disk into searchable memory for any MCP-speaking AI assistant. When you start a new session and ask *"what did we figure out about X?"*, the assistant calls a tool that actually goes and looks. When you sketch an idea mid-conversation, the assistant files it as a typed page that future-you can find again. Plain text on your disk; nothing locked behind a SaaS. As of v0.4, the same binary also runs as an HTTP server with bearer-authenticated capability scoping — same vault, same tools, networked — for operators dispatching agent pipelines.

**What using it feels like.**

> *Tuesday, mid-thought:* "Save this — event sourcing might be cleaner for state diffs." Lands in your inbox as a one-line capture.
>
> *Sunday morning:* "Process my inbox." The assistant walks each item, proposes a type (*idea*? *decision*? *question*?), files it.
>
> *Three weeks later, brand new chat:* "What do we know about state management?" The assistant finds four prior pages, summarizes them, offers to roll them into one synthesis page.

**One vault, every repo.** Switch projects; your knowledge follows you. Stoa is registered once globally with your AI client and works in any repo you open.

**Beyond a single user.** Multiple AI instances can read the same vault, claim tasks atomically, and coordinate via shared channels — the substrate works the same whether you're solo or running multiple agents.

**Who it's for.** Anyone tired of starting over each session. You don't need to be technical — Stoa runs locally on your machine, the assistant does the organizing.

## Install

```bash
npm i -g @stoa-mcp/cli
```

Then add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "stoa": {
      "command": "stoa",
      "args": ["--mcp"],
      "env": { "STOA_VAULT_PATH": "/path/to/your/vault" }
    }
  }
}
```

Restart Claude Code. You now have `vault_recall`, `vault_inbox`, `vault_synthesize`, and ~30 other tools available in every session.

> Snippet shown for Claude Code. The same `stoa mcp` command runs as a stdio MCP server, so any MCP-compatible client should work — check your client's docs for its config schema and file location.

## Tools (quick reference)

> **v0.5 consolidated 19 tool names into 8** `mode`/`surface`-parametrized tools (surface dropped 55 → 43). If you're upgrading from an older name like `vault_task-create` or `vault_channel-tail`, see the [v0.5 release notes](#v05--tool-surface-family-consolidation) for the full rename map and migration.

**Read:**
- `vault_recall` — search vault, segmented by layer; reads matching synthesis content inline
- `vault_read` — fetch a page by id or path
- `vault_list-wikis` — list wikis with mode, scope, and summary stats
- `vault_lint` — read-only health check (orphans, schema violations, channel format, claim invariants, synthesis debt, missing curation priority)
- `vault_channel` — pull recent entries on a coordination channel or post to one; `mode: tail|post`

**Wait (push primitives):** block until vault events occur instead of polling
- `vault_wait-for` — block until a matching event lands; `mode: next|any|all|many` controls fan-out semantics (race, all-matched, bounded batch)

**Write — content:**
- `vault_inbox` — capture a fleeting thought to the active wiki's `inbox/`
- `vault_process-inbox` — walk inbox items, propose types, and promote on confirmation
- `vault_new` — create a typed page from a template
- `vault_new-wiki` — scaffold a new wiki: folders, `map.md`, `index.md`, wiki-local `CLAUDE.md`
- `vault_set-active` — set the ambient active wiki
- `vault_synthesize` — compile or refresh a synthesis page from matching pages
- `vault_agent-journal` — append a first-person agent reflection at end-of-task

**Write — system:**
- `vault_reindex` — regenerate `_index/` files and per-wiki `index.md`
- `vault_curate` — autonomously promote/archive/resolve pages on checkable evidence; one digest-journal audit trail; git-reversible; admin-scoped over HTTP

**Coordination:**
- `vault_channel` — post to or tail a coordination channel; `mode: post|tail`
- `vault_task` — full task lifecycle: `mode: create|list|update|claim` (claim is atomic; race-loser sees `AlreadyClaimedError`)
- `vault_bootstrap-repo` — wire a consuming repo with `.mcp.json` and a `CLAUDE.md` fragment

**Agent memory:**
- `vault_agent-memory` — pull an agent's accumulated claims: ranked, scope-filtered, decay-aware; suitable for system-prompt injection
- `vault_claim` — author, re-validate, supersede, or retract a claim that persists across sessions
- `vault_list-claims` — list claims filtered by agent, scope, or tag

**Agent substrate:**
- `vault_start` — cold-start brief: active pages, channel unread counts, in-flight tasks
- `vault_sync` — deploy agent skills or dispatch a subagent intent; `surface: skills|agents`
- `vault_profile-stats` — compute evolution metrics and move-mastery scores for a profile

> **v0.4 server-mode note.** A handful of these tools — `vault_sync` (both surfaces), `vault_bootstrap-repo`, `vault_seed-substrate`, and map writes via `vault_new` — are HTTP-forbidden and only callable in stdio mode. Admin-shaped tools (`vault_reindex`, `vault_set-active`, `vault_new-wiki`, `vault_evolve-profile`, `vault_lint --scope=full`) require an explicit `admin:*` scope on HTTP tokens. Stdio invocations remain unrestricted. See [`docs/server-mode.md`](docs/server-mode.md) for the full scope grammar.

## Agent coordination

Multiple AI instances — different repos, different machines — can share the same vault and coordinate without copy-paste. Agents post and tail named channels (`vault_channel` with `mode: post|tail`) to pass work between sessions. Tasks are queued as typed pages and claimed atomically (`vault_task` with `mode: claim`), so two racing sessions can never silently double-claim the same work. Agents also accumulate persistent memory across sessions: a non-obvious invariant discovered during debugging becomes a `vault_claim`; the next session pulls it back via `vault_agent-memory` before starting work.

See [docs/agent-memory.md](docs/agent-memory.md) for the claim authoring and retrieval protocol, and [docs/task-coordination.md](docs/task-coordination.md) for the full task lifecycle and channel conventions.

## Resolution order for the `wiki:` parameter

1. Explicit `wiki:` arg on the tool call.
2. `--default-wiki=<name>` flag on the server invocation.
3. `.active-wiki` file at vault root.
4. Error.

## Server mode (v0.4+)

Stoa can also run as an HTTP MCP server with bearer-authenticated capability scoping, for operators dispatching agent pipelines that can't share a process boundary with Stoa:

```bash
docker run -p 8443:8443 -v stoa-vault:/vault \
  -e STOA_VAULT_PATH=/vault \
  -e STOA_TOKEN_SIGNING_SECRET="$(openssl rand -hex 32)" \
  ghcr.io/brettnye/stoa:0.4.0 serve
```

Clients authenticate with HS256 JWTs signed by the same secret; scopes carried on the token gate every tool call. See [`docs/server-mode.md`](docs/server-mode.md) for deployment, the two-tier operator/worker credential pattern, and troubleshooting.

**v0.4 includes a breaking change** for clients that previously passed `agent_id` in tool input — see [v0.4 release notes](#v04--server-mode) below for migration. Solo-laptop `stoa --mcp` stdio mode continues to work unchanged.

## Dashboard (`stoa ui`)

Run `stoa ui` and a local HTTP dashboard opens in your browser. It's a read view onto the agent substrate — agents, tasks, channels — plus two ambient queues that surface obligations your `CLAUDE.md` declared but nothing is actively watching for you.

The framing that drove the design: *the dashboard's job isn't to show vault state — it's to render `CLAUDE.md`'s unwritten obligations as actionable rows.* When you wrote "synthesize monthly" or "claims expire after 45 minutes" into your contract, you made promises with no enforcement. The dashboard turns each one into a row you can act on.

![stoa dashboard](docs/img/dashboard.png)

### The three panes

- **Agents** (left) — every registered agent profile: sprite, Pokemon name, type, evolution stage, claimed-task count. `+ new agent` spawns one.
- **Tasks** (center) — filterable by status (active / all / pending / claimed / in_progress / completed / failed / blocked). Each row shows title, wiki, status, claimer, channel, required Pokemon type, last-updated.
- **Channels** (right) — recent posts across every coordination channel, newest first.

### Two ambient queues

- **Stuck-claim ribbon** (top of page, only when needed) — surfaces tasks claimed or in-progress past threshold (15min / 45min). Per row: `release` to free the claim, `ping` to nudge the channel.
- **Stale-syntheses drawer** (header toggle) — synthesis pages sorted by `last_compiled` lag, with a count of `related:` pages that have moved since compile. One click deep-links to `/synthesize` for that topic.

### Other niceties

- **Pinned views** — every filter and selection serializes into the URL hash; `+ pin` saves the current view as a chip in the header.
- **CSRF-protected writes** — `claim`, `release`, `post`, `spawn`. Origin-header check; localhost-bound by default.
- **No build step** — Hono + vanilla JS + Alpine.js. Static files served from the same Node process.

### Launch

```bash
stoa ui
```

Defaults: serves at `http://127.0.0.1:4321` and opens your default browser. Override with `--port`, `--bind`, `--no-open`.

## CLI

You can also drive the vault from the terminal:

```bash
stoa --vault=/path/to/vault recall <topic>
stoa --vault=/path/to/vault inbox "thought to capture"
stoa --vault=/path/to/vault list-wikis
```

Set `STOA_VAULT_PATH` to skip `--vault=` on every call.

## Documentation

- [Installation](docs/installation.md) — full install + configuration walkthrough
- [Quickstart](docs/quickstart.md) — your first useful `recall` in 5 minutes
- [Common workflows](docs/common-workflows.md) — task-driven recipes for the things you'll actually do
- [Tool reference](docs/tool-reference.md) — alphabetical reference for every `vault_*` MCP tool
- [Manual smoke test](docs/manual-smoke-test.md) — verify your setup
- [wait-for: push primitives](docs/wait-for.md) — `vault_wait-for` (mode: next|any|all|many) over the local FS-watch event bus
- [Server mode](docs/server-mode.md) — operator deployment guide for the HTTP transport (v0.4+); Day-zero install, Fargate task definitions, two-tier credentials, troubleshooting

## Tests

```bash
npm test          # unit + integration
npm test -- e2e   # end-to-end via real MCP client
```

## v0.5 — tool-surface family consolidation

Eight families of single-purpose MCP tools collapse into eight `mode`/`surface`-parametrized tools. The advertised `vault_*` surface drops from **55 → 43**. Underlying behavior is preserved — only the tool *names* and call shape change. Solo-laptop `stoa --mcp` stdio mode and HTTP server mode both continue to work unchanged.

### Changed (BREAKING) — 19 tool names retire into 8

Each family now exposes a single tool that takes a `mode:` (or `surface:` for `vault_sync`) discriminator instead of a separate tool per operation.

| Retired names | Consolidated | Discriminator |
|---|---|---|
| `vault_wait-for-any`, `vault_wait-for-all`, `vault_wait-for-many` | `vault_wait-for` | `mode: next\|any\|all\|many` |
| `vault_trainer-submit-draft`, `vault_trainer-submit-move` | `vault_trainer-submit` | `mode: draft\|move` |
| `vault_merge-queue`, `vault_merge-record` | `vault_merge` | `mode: queue\|record` |
| `vault_list-invites`, `vault_list-platform-profiles` | `vault_stadium-list` | `mode: invites\|platform-profiles` |
| `vault_task-create`, `vault_task-list`, `vault_task-update`, `vault_task-claim` | `vault_task` | `mode: create\|list\|update\|claim` |
| `vault_channel-post`, `vault_channel-tail` | `vault_channel` | `mode: post\|tail` |
| `vault_real-skill-register`, `vault_real-skill-refresh` | `vault_real-skill` | `mode: register\|refresh` |
| `vault_sync-skills`, `vault_sync-agents` | `vault_sync` | `surface: skills\|agents` |

**Migration.** Drop the old name, use the consolidated name, and add the appropriate `mode:`/`surface:` field — e.g. `vault_task-create { ... }` → `vault_task { mode: "create", ... }`. Two extra notes:

- **`vault_sync` field rename:** the overloaded `target` is split — filesystem path is now `repo_path`, output format is now `runtime`, on both surfaces.
- **Scope tokens** (HTTP mode) embed the tool name, so a scope like `vault_task-claim:tasks/<id>` becomes `vault_task:tasks/<id>`. Re-mint tokens issued against retired names.

## v0.4 — server mode

Networked HTTP transport with JWT-based bearer auth and capability scoping. Lets operators run Stoa as a hosted MCP endpoint reachable from dispatched workers (Fargate tasks, Agora-dispatched sub-agents, CI fleets) without sharing a process boundary. Solo-laptop `stoa --mcp` stdio mode continues to work unchanged. Full deployment walkthrough at [`docs/server-mode.md`](docs/server-mode.md); design rationale at [`docs/superpowers/specs/2026-05-21-stoa-server-mode-design.md`](docs/superpowers/specs/2026-05-21-stoa-server-mode-design.md).

### Added — transport + CLI

- **`stoa serve [--bind=HOST:PORT] [--vault=PATH]`** — boots the HTTP MCP server. Hono + MCP `StreamableHTTPServerTransport` in stateful mode. `/health` endpoint for ALB / Fargate liveness probes. Bind defaults to `127.0.0.1:8443`.
- **`stoa mint-token --agent-id=X --scope=Y[,Z] --ttl=30m`** — HS256 JWT signer for testing and operator-token bootstrap. Reads `STOA_TOKEN_SIGNING_SECRET` from env; never round-trips through Stoa.
- **`stoa init -y`** — non-interactive init for Docker / CI bootstrap. Reads `STOA_VAULT_PATH`, `STOA_THEME`, `STOA_DEFAULT_WIKI` from env.
- **`vault_lint --scope=full`** — whole-vault lint pass (admin-only over HTTP). Default `per-wiki` scope is unrestricted.
- **Docker image** at `ghcr.io/brettnye/stoa:0.4.0`. Multi-stage `node:20-slim` build; `CMD ["serve", "--bind=0.0.0.0:8443"]`.

### Added — auth + capability scoping

- **HS256 JWTs**, integrator-minted, Stoa verifier-only. No token issuance endpoint. Signing secret in `STOA_TOKEN_SIGNING_SECRET` env var, shared between Stoa and the orchestrator process. RS256 / JWKS path-of-record; HMAC only in v0.4.
- **Bearer tokens** carry `sub` (becomes `agent_id`), `scopes`, `exp`, `iat`, `jti`. Verified once at session `initialize`; principal binds to the MCP session for subsequent tool calls.
- **Hybrid scope grammar**: closed tool-prefix + open `picomatch` glob over a per-tool axis. Examples: `vault_recall:wikis/project-acme/**`, `vault_task:tasks/review-abc`, `vault_channel:channels/build-coord`.
- **Three-gate dispatcher** per tool call: HTTP-forbidden → admin → axis. Stdio principals carry `*:*` and bypass every gate. HTTP tokens with `admin:*` subsume the axis check for that tool. Scope denials raise `ScopeDeniedError` with the rejected axis string for client diagnostics.
- **Admin-required tools** (`vault_reindex`, `vault_evolve-profile`, `vault_set-active`, `vault_new-wiki`, map writes via `vault_new`, `vault_lint --scope=full`) refuse HTTP calls without `admin:*` or `admin:<tool>`.
- **HTTP-forbidden tools** (`vault_sync` (both surfaces), `vault_bootstrap-repo`, `vault_seed-substrate`) are refused over HTTP regardless of scopes — stdio-only.

### Added — concurrency

- **Per-task locking on `vault_task` (mode: claim).** `claimTask` now wraps its read-check-write in `withSerializedIndexWrite([\`task-${id}\`], ...)`. Closes the documented same-day race where two concurrent claimants could both pass the frontmatter-date OCC and double-claim. `claimTask` is now `async`; existing callers already await it.
- **Stale-lock detection** on lock acquisition: 60s threshold, capped at 3 stale-unlink retries per lock to bound the loop under adversarial mtime (clock skew, antivirus interruption, crashed writers). Replaces the orphaned-lock failure mode where five zero-byte locks once blocked every subsequent write.

### Added — vault config

`.stoa/config.json` at vault root carries:
- `theme: "pokemon" | "plain"` — affects scaffolding and dashboard UX, not enforcement. Default `pokemon`.
- `identity: { default_agent_id: "..." }` — fallback for stdio `Principal`. Falls through env → OS user → `"stoa-local"` if absent.
- `auth: { signing_secret_env: "STOA_TOKEN_SIGNING_SECRET", issuer_hint: "..." }` — env-var name for the signing secret; informational `iss` hint.
- `bind: "127.0.0.1:8443"` — HTTP server bind address. Overridable with `stoa serve --bind=...`.

Missing file → all defaults. Partial config merges over defaults at the key level. Malformed JSON falls back to defaults without throwing.

### Changed (BREAKING) — `agent_id` removed from write tools

The following tools no longer accept `agent_id` in their Zod input schemas. The server now stamps `agent_id` from the verified principal — clients passing it explicitly will fail Zod parse with a clear error:

- `vault_channel` (mode: post), `vault_agent-journal`
- `vault_task` (mode: claim|update|create)
- `vault_claim` (`authored_by` also dropped — retract authorization compares against `ctx.principal.agent_id`)
- `vault_agent-memory`

**Migration**: run `stoa lint` and look for `AGENT_ID_INPUT_LEAK` warnings. For each call site, move `agent_id` from the tool input to `ctx.principal: { agent_id: "..." }`. The lint rule scans `.ts` and `.md` files for the pattern and reports affected paths.

### New lint code

- **`AGENT_ID_INPUT_LEAK`** (warning) — caller code passes `agent_id` to a write tool whose schema no longer accepts it. Locates within a 200-char window of the tool name.

### Security

- Audit trail is now structurally truthful: `agent_id` cannot be self-asserted over HTTP. The server stamps it from the JWT `sub` claim, which the client cannot forge without the signing secret.
- Map writes (`vault_new --type=map`) require `admin:*` over HTTP — `map.md` files are curation, not dispatch.
- Substrate-scaffolding tools (`vault_sync-*`, `vault_bootstrap-repo`, `vault_seed-substrate`) are HTTP-forbidden — they write to consuming repos' filesystems and don't make sense over the wire.

### Fixed

- `withSerializedIndexWrite` stale-lockfile failure mode (orphaned `.lock` files from crashed writers no longer block all subsequent writes).
- `bin.ts` parseConfig vault-required check now bypasses for `serve` and `mint-token` subcommands that handle their own vault resolution (or don't need a vault at all).
- `vitest.config.ts` `include` pattern now covers co-located `src/**/*.test.ts` files alongside the existing `tests/` tree.

## v0.3 — specialist agent substrate

Substrate additions landed 2026-05-19 that let agents develop deep domain competence without breaking the portable-moves contract. Reference only — see `wikis/_meta/specs/2026-05-19-specialist-agent-substrate-design.md` for the design and `wikis/_agents/guides/guide-using-wiki-local-moves.md` + `wikis/_agents/guides/guide-authoring-a-course.md` for the operator walkthroughs.

### New MCP tool flags

- `vault_claim --source-type=lived|curricular|retro` — claim provenance. Default `lived`. `lived` cites real journal/task/PR evidence; `curricular` cites a course guide page; `retro` cites older artifacts a pattern was extracted from.
- `vault_list-claims --source-type=<value>` — filter the claim list by source_type. Parallel surface to the existing `--profile=` / `--move=` filters.
- `vault_bootstrap-repo --wiki=<name>` — now layers every `wikis/<wiki>/moves/<id>/SKILL.md` on top of the resolved profile's portable moveset. Deployed CLAUDE.md fragment renders `### Portable moves` and `### Specialist moves (<wiki>)` subsections.
- `vault_sync` (surface: skills) — same wiki-local layering when called from a context that passes the wiki through. (The CLI `sync-skills` subcommand does not currently expose `--wiki=` — use `bootstrap-repo --wiki=` from the terminal, or call `vault_sync` with `surface: "skills"` directly via the MCP tool.)

### Sidecar schema bump

- `_index/claims.json` `schema_version` is now `3` (was `2`). Adds a `by_source_type` bucket with `lived`, `curricular`, `retro` arrays of claim ids. Readers tolerate `1 | 2 | 3` for back-compat; writers emit `3` going forward.

### New lint codes — moves

- `MOVE_SCOPE_WIKI_FOLDER_MISMATCH` (error) — `scope_wiki:` value does not match the move's parent folder wiki.
- `MOVE_SCOPE_WIKI_MISSING` (warning) — move under `wikis/<wiki>/moves/` (non-`_agents`) has no `scope_wiki:` field.
- `MOVE_PORTABLE_HAS_SCOPE` (warning) — move under `wikis/_agents/moves/` erroneously carries `scope_wiki:`.
- `MOVE_ID_SHADOWS_PORTABLE` (warning) — wiki-local move id collides with a portable move id; portable wins at deploy time.

### New lint code — claims

- `CLAIM_SOURCE_TYPE_INVALID` (error) — claim frontmatter has `source_type:` set to a value outside `lived | curricular | retro`. Absent field treated as default `lived` and does not trigger.

## License

FSL-1.1-MIT — commercial use allowed, no competing-product clones, converts to MIT after 2 years. See [LICENSE](LICENSE).
