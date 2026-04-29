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
