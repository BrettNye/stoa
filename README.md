# Stoa

> Persistent shared memory for AI coding agents.
> Your Claude Code sessions stop forgetting things across days, repos, and machines.

[![npm version](https://img.shields.io/npm/v/@stoa-mcp/cli)](https://www.npmjs.com/package/@stoa-mcp/cli)
[![License: FSL-1.1-MIT](https://img.shields.io/badge/license-FSL--1.1--MIT-blue)](LICENSE)

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

## Why Stoa

- **Persistent across sessions.** Decisions, specs, and context you capture today are instantly available in tomorrow's session — no re-explaining from scratch.
- **Persistent across repos.** One vault serves every project. Switch repos; your knowledge follows you.
- **Multi-agent coordination.** Multiple Claude Code instances can read the same vault, claim tasks, and post to shared channels without conflicts.
- **Idea mapping, not just notes.** Typed pages (`concept`, `decision`, `synthesis`, `spec`) and structured indexes let AI search and reason over your knowledge — not just retrieve raw text.

## How it works

Stoa is a local MCP server that exposes your vault — a folder of Markdown files with structured frontmatter — as queryable tools. When Claude Code calls `vault.recall`, it searches a pre-built token index and returns ranked, layer-segmented hits with synthesis content inlined. When it calls `vault.inbox`, it appends a timestamped draft to your active wiki. Everything is plain files on disk; no database, no cloud sync required.

## Tools (quick reference)

**Read:**
- `vault.recall` — search vault, segmented by layer; reads matching synthesis content inline
- `vault.read` — fetch a page by id or path
- `vault.list-wikis` — list wikis with mode, scope, and summary stats
- `vault.lint` — read-only health check (orphans, schema violations, channel format, claim invariants, synthesis debt, missing curation priority)
- `vault.channel-tail` — pull recent entries on a coordination channel

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
- [Manual smoke test](docs/manual-smoke-test.md) — verify your setup
- [wait-for: push primitives](docs/wait-for.md) — `vault.wait-for{,-any,-all,-many}` over the local FS-watch event bus

## Tests

```bash
npm test          # unit + integration
npm test -- e2e   # end-to-end via real MCP client
```

## License

FSL-1.1-MIT — commercial use allowed, no competing-product clones, converts to MIT after 2 years. See [LICENSE](LICENSE).
