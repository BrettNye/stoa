---
id: move-pr-create
title: "Create a PR"
type: move
wiki: _agents
status: active
summary: "Open a pull request from the current branch with a structured description"
name: pr-create
description: "Use when implementation on a feature branch is complete and ready for review."
move_type: process
applies_to: [claude-code, openclaw]
pokemon_type: water
tags: [process, git, pr, agent, move]
---

# Create a PR

## When to use

Implementation on a feature branch is complete; tests are green; the branch is ready for merge review. The PR is the handoff to the merge gatekeeper (the user, or a higher-stage agent).

## How to apply

0. **Preflight checks.** Before pushing, verify two things:
   - `git remote -v` shows an `origin`. If not, the worktree was created without a remote (common in fresh setups). Run `git remote add origin <url>` first or post the local branch name to the channel and let the user push from main.
   - `which gh` returns a path AND `gh auth status` succeeds. If `gh` is broken, fall back to: push the branch, then post the GitHub compare URL (`https://github.com/<owner>/<repo>/compare/<branch>?expand=1`) to the channel for the user to click and open the PR manually.

1. Confirm the branch's state: `git status` (clean) and `git log --oneline main..HEAD` (commits present and atomic).
2. Push the branch: `git push -u origin <branch>` if not yet tracking.
3. Open the PR via `gh pr create`. The title is short (under 70 chars). The body has two sections: **Summary** (what changed and why, 1-3 bullets) and **Test plan** (a markdown checklist of what was verified).
4. Post a notification to the feature's coordination channel: `vault_channel-post --channel=<feat-channel> --content="PR ready: <pr-url>"`.
5. Append an end-of-task journal entry referencing the PR.

## What this move does NOT do

- Does not merge the PR — that's the user's call (or a higher-stage profile's merge move).
- Does not force-push or rewrite published history.
