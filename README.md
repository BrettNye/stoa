# vault-mcp

MCP server + CLI that powers the [knowledge vault](../) — the *engine* behind the workflows. This README covers install, MCP wiring, tool reference, and bootstrapping a consuming repo.

For the **knowledge model** — what a `synthesis` is, what a `concept` is, how the lifecycle flows — see the [root README](../README.md). This doc focuses on running the engine, not authoring with it.

## Install

For local development:

```bash
cd vault-mcp
npm install
npm run build
```

For global use, link the package:

```bash
npm link
# now `vault` and `vault-mcp` are on PATH
```

## Run as CLI

```bash
vault --vault=/path/to/vault recall <topic>
vault --vault=/path/to/vault inbox "thought to capture"
vault --vault=/path/to/vault list-wikis
vault --vault=/path/to/vault lint
```

Set `VAULT_PATH` env var to skip `--vault=` on every call.

## Run as MCP server

```bash
vault --mcp --vault=/path/to/vault [--default-wiki=<name>]
```

In Claude Code, add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "vault": {
      "command": "vault",
      "args": ["--mcp", "--vault=/path/to/vault"]
    }
  }
}
```

For per-repo default wiki, drop `.mcp.json` at the repo root with
`--default-wiki=<name>` added to args.

## Tools (15)

See [the v1 spec](../wikis/_meta/specs/2026-04-28-vault-mcp-v1-design.md) §5
for full input/output schemas. Quick reference:

- **Read:** `vault.recall`, `vault.read`, `vault.list-wikis`, `vault.lint`, `vault.channel-tail`
- **Write — content:** `vault.inbox`, `vault.process-inbox`, `vault.new`, `vault.new-wiki`, `vault.set-active`, `vault.synthesize`, `vault.agent-journal`
- **Write — system:** `vault.reindex`
- **Coordination:** `vault.channel-post`, `vault.task-claim`

## Resolution order for `wiki:` parameter

1. Explicit `wiki:` arg on the tool call.
2. `--default-wiki=<name>` flag on the server invocation.
3. `.active-wiki` file at vault root.
4. Error.

## Tests

```bash
npm test          # unit + integration
npm test -- e2e   # end-to-end via real MCP client
```
