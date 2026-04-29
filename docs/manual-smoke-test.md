# Manual cross-repo smoke test

Run this once per release to verify the cross-repo workflow end-to-end.

## Setup

1. Vault is at `C:/Users/brett/Documents/Knowledge/`.
2. `vault-mcp` is built (`npm run build`).
3. User-level Claude Code config in `~/.claude/settings.json` has the vault MCP.

## Steps

### 1. Throwaway test repo

```bash
mkdir -p ~/sandbox/cross-repo-test
cd ~/sandbox/cross-repo-test
git init
echo "# test" > README.md
```

Open Claude Code in this directory.

### 2. Verify recall from this repo

```
> /recall foo
```

Expected: hits from the vault (concept-foo, etc.) appear.

### 3. Inbox from this repo

```
> /inbox "test thought from sandbox repo"
```

Expected: confirmation with new id like `2026-XX-XX-HHMM-test-thought-from-sandbox`.

Verify in the vault folder: file exists at `wikis/<active>/inbox/`.

### 4. Cross-instance visibility

Open another Claude Code in the vault repo itself:

```
> /recall test thought from sandbox
```

Expected: the new inbox file shows up in results (after the next reindex; you may
need to run `/reindex` first for the body grep to match).

### 5. Channel coordination across instances

In sandbox repo's Claude Code:

```
> /channel-post test-coord "hello from sandbox"
```

In vault repo's Claude Code (or another sandbox):

```
> /reindex
> /channel-tail test-coord
```

Expected: the message appears.

### 6. Lint from any repo

```
> /lint
```

Expected: diagnostics from the real vault, not an error.

## Pass criteria

- All 6 steps complete without "tool not found" or "vault not initialized" errors.
- Files written from sandbox repo land in the correct vault location.
- Cross-instance reads see writes from the other instance (after reindex).

## Failure recovery

- If `/recall` returns no hits and the vault is non-empty: run `/reindex` from any repo with vault MCP.
- If a tool is missing: check `~/.claude/settings.json` MCP server config and restart Claude Code.
- If `--default-wiki` doesn't seem to apply: confirm the per-repo `.mcp.json` is at the repo root, not in a subdirectory.
