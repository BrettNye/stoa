# Installation

## Prerequisites

- Node.js >=20
- A vault directory with a `CLAUDE.md` at root and a `_index/` directory
  (created automatically on first reindex if missing)

## Phase 1 — Local development

```bash
cd vault-mcp
npm install
npm run build
```

Configure user-level Claude Code MCP at `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "vault": {
      "command": "npx",
      "args": ["tsx",
               "C:/Users/brett/Documents/Knowledge/vault-mcp/src/bin.ts",
               "--mcp",
               "--vault=C:/Users/brett/Documents/Knowledge"]
    }
  }
}
```

Restart Claude Code in any repo. The vault MCP tools are available.

## Phase 2 — npm link (when stable for daily use)

```bash
cd vault-mcp
npm link
```

Update `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "vault": {
      "command": "vault-mcp",
      "args": ["--mcp", "--vault=C:/Users/brett/Documents/Knowledge"]
    }
  }
}
```

## Phase 3 — Published to npm

```bash
npm publish
```

Update settings to `npx vault-mcp@latest --mcp --vault=...`.

## Per-repo override

To set a default wiki for a specific repo, drop a `.mcp.json` at its root:

```json
{
  "mcpServers": {
    "vault": {
      "command": "npx",
      "args": ["vault-mcp", "--mcp",
               "--vault=C:/Users/brett/Documents/Knowledge",
               "--default-wiki=mylib"]
    }
  }
}
```

## Connecting Claude Desktop (Cowork)

Claude Desktop (the host for Anthropic's Cowork) is a separate MCP client from Claude Code. The connection is **config-only — no adapter needed**: the vault MCP tool surface (`vault.recall`, `vault.inbox`, etc.) is exposed to Cowork chat sessions by registering the same `stoa` binary in Claude Desktop's config file.

**Config file path:**

| Platform | Path |
|---|---|
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` (resolves to `C:\Users\<you>\AppData\Roaming\Claude\claude_desktop_config.json`) |
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |

Create the file with `{}` if it doesn't exist. Then add a `mcpServers.stoa` stanza pointing at the precompiled binary:

```json
{
  "mcpServers": {
    "stoa": {
      "command": "node",
      "args": ["C:/Users/brett/Documents/Knowledge/stoa/dist/bin.js"],
      "env": {
        "STOA_VAULT_PATH": "C:/Users/brett/Documents/Knowledge"
      }
    }
  }
}
```

Notes:
- Use `node` (not `npx tsx`) since the `dist/` build is precompiled — faster startup, no dev dependencies needed.
- Forward slashes work in JSON on Windows; backslashes require escaping (`\\`).
- If you already have other MCP servers registered (Context7, etc.), keep them and add `stoa` as an additional key.

**Verify:** quit and relaunch Claude Desktop fully (taskbar/menu → Quit, then reopen — Claude Desktop spawns each MCP server on launch). Inside Cowork, ask: *"List the vault tools available to you."* You should see `vault.recall`, `vault.inbox`, `vault.read`, etc.

**What works:** all `vault.*` MCP tools (recall, inbox, read, claim, channel-post, journal, etc.) work identically to Claude Code — same stoa binary, same `_index/`, same filter syntax (v1 + v3).

**What does NOT yet work:** deploying Pokémon profiles and movesets into Cowork. Cowork uses a "Plugin" bundle format (skills + connectors + sub-agents) that's materially different from Claude Code's flat `.claude/agents/*.md` + `.claude/skills/` layout. `vault.sync-agents` and `vault.sync-skills` only target Claude Code today. The adapter is queued as a v1.8 substrate item — see the vault's `wikis/_meta/ideas/idea-cowork-runtime-adapter` for the design space and `wikis/_meta/guides/guide-connecting-claude-desktop-to-vault` for the full substrate context (cross-runtime concurrency notes, capability axes, etc.).

**Operational note:** running Claude Code and Cowork concurrently against the same `STOA_VAULT_PATH` exercises stoa's concurrent-write infrastructure (`withSerializedIndexWrite` lock from v1.7). It should hold, but it's a stress case worth knowing about.

## Verifying installation

In Claude Code in any repo:

```
> /recall test
```

You should see hits from your vault. If you see "tool not found" or "no MCP server", check:

1. `~/.claude/settings.json` exists and is valid JSON.
2. The `vault-mcp` command is on PATH (Phase 2+) or the path in the config is correct (Phase 1).
3. Your vault has a `CLAUDE.md` at root.
4. You've run `vault reindex` at least once so `_index/*.json` exists.
