---
id: move-channel-coordinate
title: "Coordinate via channel"
type: move
wiki: _agents
status: active
summary: "Post and tail vault channels to coordinate with other agents on the same feature"
name: channel-coordinate
description: "Use when working on a feature with parallel agents to share progress and unblock peers."
move_type: process
applies_to: [claude-code, openclaw]
pokemon_type: psychic
tags: [process, coordination, channel, agent, move]
---

# Coordinate via channel

## When to use

You are working on a feature where another agent (Pokemon) has a dependent or downstream task. The channel is the only coordination surface — no direct messaging, no shared scratch space.

## How to apply

1. At task claim, post: `vault_channel-post --channel=<feat-channel> --content="claimed: <task-title> as <pokemon-name>"`.
2. At every milestone (test green, PR ready, blocker hit), post a short status update with concrete details — branch name, file paths touched, blockers if any.
3. Tail the channel periodically while working: `vault_channel-tail --channel=<feat-channel> --since=<last-cursor>`. Use the returned `cursor` next time.
4. If unblocking a downstream agent, name them in the post: `"@squirtle: API surface ready, branch feat/api-surface, types in core/x.ts"`.

## What this move does NOT do

- Does not replace journals — channels are short-form coordination signals; journals are the work product trail.
- Does not synchronize commits — the channel is the only handshake; the merge order is the user's call.

## Heads-up before shared-file edits

Before modifying a file that a parallel sibling agent might also touch — registries, transports, shared config, or any file outside your declared task scope — post a one-line heads-up to the active channel BEFORE making the edit:

```
[heads-up] modifying <path> to <one-sentence reason>
```

This is a write-coordination signal, separate from the milestone posts in steps 1-4. Sibling agents tailing the channel can pause, plan around your change, or surface a conflict before it lands.

Rule of thumb: if two parallel agents could plausibly want to edit the same file, post the heads-up. False positives are cheap; missed coordination causes silent merge surprises.

## Channel-post format discipline

Posts are headlines, not essays. Keep each post to one line, <=80 chars where practical. Detail belongs in the agent journal, which is queryable separately. A noisy channel defeats the coordination purpose — readers stop tailing.

Suggested formats:

- Claim:        `claimed: <task-id> as <pokemon>`
- Milestone:    `<task-id>: <state> — <sha-or-branch>`  (state = "tests green", "PR ready", etc.)
- Heads-up:     `[heads-up] modifying <path> — <reason>`
- Blocker:      `BLOCKED: <task-id> — <one-sentence reason>`
- Unblock peer: `@<pokemon>: <api/path> ready, <branch-or-sha>`

## Cursor lifecycle

`vault_channel-tail` returns a `cursor` field — an ISO timestamp — that
points to the last entry visible in this read. Use it as the `since`
argument on the next call to read only new entries.

- **Initial value**: at task-claim time, capture `new Date().toISOString()`
  as your starting `since`. Any entries with `created >= since` are visible
  on the first tail.
- **Storage between calls**: store the returned `cursor` in a
  session-local variable. There is no need to persist it across sessions —
  on a cold restart, re-tailing from your task-claim timestamp is safe and
  idempotent.
- **Empty-channel case**: if the channel returns zero entries, the cursor
  echoes your `since` value. Subsequent calls with that cursor remain a
  no-op until something is posted.

A typical loop in a subagent:

```
let since = new Date().toISOString();
while (working) {
  const { entries, cursor } = vault.channelTail({ channel: "feat-X-progress", since });
  for (const entry of entries) handle(entry);
  since = cursor;
  await wait(2000);
}
```

## Vault-of-record invariant

The vault MCP server always reads and writes from the **vault root** (the main
worktree). In a git-worktree-based setup where each Pokemon works in a
separate worktree, the per-Pokemon worktrees are code sandboxes only —
they do NOT have independent vaults. Channel posts, journal writes, and
task claims all land in the main worktree's `wikis/` directory.

Practical consequence: do NOT watch your worktree's filesystem for
channel posts. Use `vault_channel-tail` instead — it reads from the vault
root regardless of which worktree your session is open in.
