# Installation

## Prerequisites

- **Node.js 20 or newer.** Check with `node --version`.
- **A vault directory** — a folder containing a `CLAUDE.md` at its root and (optionally) an `_index/` subdirectory. The `_index/` is created automatically on first reindex if missing. If you don't have a vault yet, create an empty folder and a one-line `CLAUDE.md` to start.

Throughout this guide, `<vault-path>` means the absolute path to your vault root. Examples:

- macOS / Linux: `/Users/alice/notes` or `~/notes`
- Windows: `C:/Users/alice/notes` (forward slashes work in JSON on Windows; backslashes need escaping as `\\`)

## Installation

Pick one of the three install modes. Most users want the global install.

### Global install (recommended)

```bash
npm install -g @stoa-mcp/cli
```

This puts a `stoa` command on your `PATH`. Verify with `stoa --help`.

### Run without installing (npx)

You can skip the install and let `npx` fetch and run the binary on demand:

```bash
npx -y @stoa-mcp/cli --mcp --vault=<vault-path>
```

The first run downloads the package; subsequent runs use the cached copy. Slightly slower startup than the global install.

### From source (contributors / developers)

```bash
git clone https://github.com/BrettNye/stoa.git
cd stoa
npm install
npm run build
```

This produces `dist/bin.js`, which you can invoke directly with `node dist/bin.js …` or by running `npm link` to expose the `stoa` command from the source tree.

## Configuring Claude Code

Claude Code reads MCP server configuration from either:

- **User-scoped:** `~/.claude/settings.json` (or `~/.claude.json` depending on Claude Code version) — applies to every project on the machine.
- **Project-scoped:** `.mcp.json` at the root of a specific repo — applies only when Claude Code is launched in that repo.

The MCP server needs to know your vault location. You can pass it as a CLI flag (`--vault=<path>`) or set the `STOA_VAULT_PATH` environment variable; either works.

### User-scoped — every Claude Code session

Add an `mcpServers.stoa` entry. Use whichever form matches your install mode:

**With global install:**

```json
{
  "mcpServers": {
    "stoa": {
      "command": "stoa",
      "args": ["--mcp"],
      "env": {
        "STOA_VAULT_PATH": "<vault-path>"
      }
    }
  }
}
```

**With npx (no global install):**

```json
{
  "mcpServers": {
    "stoa": {
      "command": "npx",
      "args": ["-y", "@stoa-mcp/cli", "--mcp"],
      "env": {
        "STOA_VAULT_PATH": "<vault-path>"
      }
    }
  }
}
```

Restart Claude Code. The vault MCP tools (`vault_recall`, `vault_inbox`, `vault_read`, etc.) are now callable from any project.

### Project-scoped — per-repo `.mcp.json`

Drop a `.mcp.json` at the root of a repo to set a vault-aware default specifically for that repo. Useful for setting `--default-wiki` so ambient calls (e.g., `vault_inbox` without an explicit `wiki:` argument) target the right wiki for that project:

```json
{
  "mcpServers": {
    "stoa": {
      "command": "stoa",
      "args": ["--mcp", "--default-wiki=<wiki-name>"],
      "env": {
        "STOA_VAULT_PATH": "<vault-path>"
      }
    }
  }
}
```

Project-scoped config overrides user-scoped config when both define `stoa`. Common pattern: keep user-scoped config minimal (vault path only), set `--default-wiki=<name>` per repo.

## Configuring Claude Desktop (Cowork)

Claude Desktop is the host for Anthropic's Cowork product. Connection is **config-only — no adapter needed**: the same `stoa` binary exposes every `vault_*` MCP tool to Cowork chat sessions.

**Config file path:**

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` (resolves to `C:\Users\<you>\AppData\Roaming\Claude\claude_desktop_config.json`) |

Create the file with `{}` if it doesn't exist. Add the `mcpServers.stoa` stanza using the same shape as Claude Code's config:

```json
{
  "mcpServers": {
    "stoa": {
      "command": "stoa",
      "args": ["--mcp"],
      "env": {
        "STOA_VAULT_PATH": "<vault-path>"
      }
    }
  }
}
```

(Substitute `npx -y @stoa-mcp/cli` for the `command`+`args` pair if you're not globally installed.)

**Verify:** quit and relaunch Claude Desktop fully (taskbar/menu → Quit, then reopen — the desktop app spawns each MCP server only on launch). Inside Cowork, ask: *"List the vault tools available to you."* You should see `vault_recall`, `vault_inbox`, `vault_read`, and the rest.

### What works in Cowork

- All `vault_*` MCP tools — identical surface to Claude Code, same indexes, same filter syntax.
- Shared filesystem state with Claude Code (both clients read/write the same vault directory).
- Concurrent sessions — Claude Code and Cowork can both be connected to the same vault path; stoa's `withSerializedIndexWrite` lock keeps `_index/*.json` writes consistent.

### What does NOT yet work in Cowork

- Deploying Pokémon profiles or movesets into Cowork. Cowork uses a "Plugin" bundle format that's materially different from Claude Code's flat `.claude/agents/*.md` + `.claude/skills/` layout. `stoa sync-agents` and `stoa sync-skills` currently only target Claude Code. The adapter is queued as a v1.8 substrate item.
- Slash commands. Cowork uses chat-based invocation rather than `/recall <topic>`-style shims.
- Computer-use moves. None of the existing moves model the desktop-automation capability Cowork provides; the substrate doesn't yet have a `runtime_capabilities:` axis to express the gate.

## Verifying installation

In any Claude Code session (or Cowork chat):

```
Use vault_recall to find pages about <some topic in your vault>.
```

You should see ranked hits with title, type, and summary. If you get "tool not found" or "no MCP server":

1. **Config syntax** — your settings file is valid JSON (no trailing commas, balanced braces).
2. **Binary discoverable** —
   - Global install: `stoa --version` works from a terminal. If not, ensure your global npm bin directory is on `PATH` (`npm config get prefix` to find it).
   - npx: `npx -y @stoa-mcp/cli --version` works. First run will download the package.
   - From source: the path to `dist/bin.js` in your config is correct.
3. **Vault path** — `STOA_VAULT_PATH` (or `--vault=…`) points at an absolute directory that exists and contains a `CLAUDE.md` at its root.
4. **Index initialized** — run `stoa --vault=<vault-path> reindex` once. This generates `_index/{pages,tokens,links,wikis}.json` so `vault_recall` has something to search.
5. **Client restarted** — both Claude Code and Claude Desktop only pick up new MCP server entries on relaunch.

For deeper troubleshooting (logs, manual smoke tests), see [`manual-smoke-test.md`](./manual-smoke-test.md).
