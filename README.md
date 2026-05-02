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

## Bootstrapping a consuming repo

Most repos that use this vault don't author knowledge in it — they consume it. A consuming repo wires up two things: an MCP entry so the running Claude Code session can call vault tools, and a CLAUDE.md fragment so Claude knows to use those tools without being told each time. Optionally, it deploys an agent profile's moveset as local skills.

```bash
vault bootstrap-repo --profile=charmeleon
```

This drops three artifacts at the consuming repo's root:

**1. `.mcp.json`** — registers the vault MCP server with a repo-local default wiki.

```json
{
  "mcpServers": {
    "vault": {
      "command": "vault",
      "args": ["--mcp", "--vault=<abs-path-to-vault>", "--default-wiki=<wiki-name>"]
    }
  }
}
```

**2. CLAUDE.md fragment** — appended to existing `CLAUDE.md`, or created if absent. Tells Claude to read `map.md` and run `recall` before substantive work in the wiki this repo consumes.

```markdown
## Knowledge vault

This repo consumes the vault at `<abs-path-to-vault>`. Before substantive work
on `<topic>`, read `wikis/<wiki>/map.md` and run `vault.recall <topic>`. The
auto-memory is short-term; the vault is canonical.
```

**3. `.claude/skills/`** *(if `--profile=<id>` was passed)* — the named profile's moveset, deployed as one skill directory per move (`.claude/skills/<move-id>/SKILL.md`).

> Today: Claude Code (`.claude/skills/`). Planned: **OpenClaw** — portable agent definitions sync to OpenClaw too, so you author once and deploy to multiple runtimes. The SKILL.md format is already the open standard shared by Claude Code, OpenClaw, Codex, and Gemini CLI; vault frontmatter is a superset that those consumers ignore.

After bootstrap, every Claude Code session in this repo has the vault tools available, knows the cross-session memory contract, and (if a profile was deployed) starts with a curated moveset.

To re-deploy a moveset later (e.g., after evolving the profile):

```bash
vault sync-skills --profile=<profile-id> --target=.
```

For full agent-substrate context (what a profile is, what a move is, how channels and tasks work), see [`../wikis/_agents/README.md`](../wikis/_agents/README.md).

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
