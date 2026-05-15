# Stoa

> Persistent shared memory for AI coding agents.
> Your sessions stop forgetting things across days, repos, and machines.

[![npm version](https://img.shields.io/npm/v/@stoa-mcp/cli)](https://www.npmjs.com/package/@stoa-mcp/cli)
[![License: FSL-1.1-MIT](https://img.shields.io/badge/license-FSL--1.1--MIT-blue)](LICENSE)

**The pain it solves.** Every new AI chat session starts blank. You re-explain the same context, re-derive the same conclusions, re-justify the same decisions. Six months from now you'll spec the same thing for the fourth time because nobody — you or the AI — remembers the prior three.

**What it is.** A local MCP server that turns a folder of markdown files on your disk into searchable memory for any MCP-speaking AI assistant. When you start a new session and ask *"what did we figure out about X?"*, the assistant calls a tool that actually goes and looks. When you sketch an idea mid-conversation, the assistant files it as a typed page that future-you can find again. Plain text on your disk; nothing locked behind a SaaS.

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
      "args": ["mcp"],
      "env": { "STOA_VAULT_PATH": "/path/to/your/vault" }
    }
  }
}
```

Restart Claude Code. You now have `vault.recall`, `vault.inbox`, `vault.synthesize`, and ~30 other tools available in every session.

> Snippet shown for Claude Code. The same `stoa mcp` command runs as a stdio MCP server, so any MCP-compatible client should work — check your client's docs for its config schema and file location.

## Tools (quick reference)

**Read:**
- `vault.recall` — search vault, segmented by layer; reads matching synthesis content inline
- `vault.read` — fetch a page by id or path
- `vault.list-wikis` — list wikis with mode, scope, and summary stats
- `vault.lint` — read-only health check (orphans, schema violations, channel format, claim invariants, synthesis debt, missing curation priority)
- `vault.channel-tail` — pull recent entries on a coordination channel

**Wait (push primitives):** block until vault events occur instead of polling
- `vault.wait-for` — block until one matching event lands; cursor-based catch-up
- `vault.wait-for-any` — wake on first match across N filters (race semantics)
- `vault.wait-for-all` — wake when all N filters have matched at least once
- `vault.wait-for-many` — bounded batch over a window

**Write — content:**
- `vault.inbox` — capture a fleeting thought to the active wiki's `inbox/`
- `vault.new` — create a typed page from a template
- `vault.new-wiki` — scaffold a new wiki: folders, `map.md`, `index.md`, wiki-local `CLAUDE.md`
- `vault.set-active` — set the ambient active wiki
- `vault.synthesize` — compile or refresh a synthesis page from matching pages
- `vault.agent-journal` — append a first-person agent reflection at end-of-task

**Write — system:**
- `vault.reindex` — regenerate `_index/` files and per-wiki `index.md`

**Coordination:**
- `vault.channel-post` — post to a coordination channel (cross-instance comms)
- `vault.task-claim` — atomically claim a pending task; race-loser sees `AlreadyClaimedError`
- `vault.bootstrap-repo` — wire a consuming repo with `.mcp.json` and a `CLAUDE.md` fragment
- `vault.sync-skills` — deploy an agent profile's moveset as local skills
- `vault.task-create`, `vault.task-list`, `vault.task-update` — task lifecycle

## Resolution order for the `wiki:` parameter

1. Explicit `wiki:` arg on the tool call.
2. `--default-wiki=<name>` flag on the server invocation.
3. `.active-wiki` file at vault root.
4. Error.

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
- [Tool reference](docs/tool-reference.md) — alphabetical reference for every `vault.*` MCP tool
- [Manual smoke test](docs/manual-smoke-test.md) — verify your setup
- [wait-for: push primitives](docs/wait-for.md) — `vault.wait-for{,-any,-all,-many}` over the local FS-watch event bus

## Tests

```bash
npm test          # unit + integration
npm test -- e2e   # end-to-end via real MCP client
```

## License

FSL-1.1-MIT — commercial use allowed, no competing-product clones, converts to MIT after 2 years. See [LICENSE](LICENSE).
