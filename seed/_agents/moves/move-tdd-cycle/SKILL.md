---
id: move-tdd-cycle
title: "TDD cycle"
type: move
wiki: _agents
status: active
summary: "Red-green-refactor with test-first discipline"
name: tdd-cycle
description: "Use when implementing any feature or bugfix, before writing implementation code."
move_type: process
applies_to: [claude-code, openclaw, codex]
pokemon_type: ghost
tools_used: [Bash, Edit, Read, Grep, Glob, Write]
tags: [process, testing, agent, move]
---

# TDD cycle

## When to use

Any time you're about to write or modify implementation code that has measurable behavior.

## How to apply

1. **Write the failing test first.** The test name describes the behavior; assertions are specific. Don't write generic test scaffolding.
   - **Hermetic by default.** Tests must not mutate the project's source-of-truth files. Use temp dirs (`os.tmpdir()`, project-specific helpers), in-memory stores, or fixtures. Never call generators / builders / reindexers against the live worktree from a test — the artifact will leak into `git status` and confuse the next agent. If a test legitimately needs a live path, gate it behind an explicit opt-in (env var, separate suite) and call it out in the test name.
2. **Run the test.** Verify it fails for the right reason — function not defined, type missing, expectation mismatch. Not a typo or import error.
3. **Write the minimal implementation.** Just enough code to make the test pass. Resist the urge to "while I'm here" refactor.
4. **Run the test.** Verify it passes.
5. **Run the full suite.** Catch regressions.
6. **Scope check before commit.** Run `git diff --stat` and `git status`. Every changed file must be one you intended to modify. Stray adjacent edits (a typo fix in a sibling file, an import cleanup) get reverted or moved to their own commit. Don't smuggle them in.
7. **Commit.** Atomic commit per behavior. Stage by path (`git add path1 path2`), not `git add -A`.

## Why ghost-type

Ghost catches what others miss. TDD's job is to surface bugs before they ship.

## Notes

If the test is hard to write, the design is hard to use. Treat that as a signal — ask whether the unit boundaries are right before fighting the test.
