---
id: move-journal-end-of-task
title: "Journal end-of-task"
type: move
wiki: _agents
status: active
summary: "Append a first-person journal entry summarizing what was done and what's left for the next agent"
name: journal-end-of-task
description: "Use immediately upon completing a claimed task before status=completed."
move_type: process
applies_to: [claude-code, openclaw, codex]
pokemon_type: grass
tags: [process, journal, agent, move]
---

# Journal end-of-task

## When to use

You have just completed a claimed task. Status is about to flip to `completed`. The journal entry is the trail future-you (or a peer agent) needs to understand what happened.

## How to apply

1. `vault_agent-journal --entry="<short title>: <2-3 sentence summary of work>" --agent_id=<your-bare-name> --channel=<feat-channel-if-any>`.
2. The summary should answer: what was the goal, what changed, what's the user-visible outcome, what's left for downstream tasks.
3. If the work surfaced friction (something harder than expected, an unclear spec, a tooling gap), include it in the journal — friction is data.

## What this move does NOT do

- Does not include implementation details — the commit message handles that.
- Does not duplicate channel posts — the channel is short-form; the journal is narrative.
