# The agent substrate

This is the wiki where agent infrastructure lives — profiles, moves, journals, channels, and the global task queue. If you're trying to understand "what's a profile / move / agent in this vault, and how do multiple agent instances coordinate," start here.

For the knowledge model (concepts, syntheses, decisions, the lifecycle), see the vault root `README.md`. For install and tools, see the stoa package README. For schema, see the vault root `CLAUDE.md`.

## What `_agents/` is

`_agents/` is a **reserved cross-cutting wiki** — name starts with `_` and is exempt from the normal "one bounded idea per wiki" rule. It holds infrastructure, not topical knowledge. Three subfolders are unique to this wiki:

- `profiles/` — one `profile-<pokemon>.md` per agent (`profile-charmander.md`, etc.)
- `moves/` — one **directory** per move (`moves/<move-id>/SKILL.md`)
- `guides/` — onboarding courses and other agent-facing guides

The reason it's a wiki and not just a folder: agents author journal entries, run tasks, and accumulate memory the same way knowledge content accumulates in topical wikis. Putting that machinery in a wiki means `recall`, `lint`, `reindex`, and the cross-session memory contract apply to agents the same way they apply to specs and decisions.

## The agent model — three types

An agent is described on disk by three types:

- **`profile`** — the agent's persona, role, conventions, and moveset. One per agent.
- **`move`** — a portable, runtime-agnostic skill. Many per profile (the moveset).
- **`journal`** — append-only first-person reflection at end-of-task. Many per agent.

Profile + moveset = the agent's *self-description*. Journals = the agent's *history*.

## `profile` — an agent's persona

> A page describing an agent's role, constraints, and the moves it brings to a task. **The agent's identity on disk.** A profile evolves over time (e.g. charmander → charmeleon → charizard); `previous_names:` and the alias index preserve historical references.

**Use when** you're defining an agent — its role, autonomy level, conventions, and which moves it can apply.

**Don't use when** you're describing a *technique* an agent uses (that's a `move`), or an agent's *post-hoc reflection* on a task (that's a `journal`).

**What one looks like** (excerpt from `profiles/profile-charmander.md`):

```markdown
---
id: profile-charmander
title: Charmander
type: profile
wiki: _agents
status: active
summary: 'Backend Pokemon — async-task work, DB-touching code, API surfaces'
pokemon_type: fire
evolution_stage: basic
autonomy_level: restricted
moveset:
  - move-tdd-cycle
  - move-pr-create
  - move-channel-coordinate
  - move-journal-end-of-task
applies_to:
  - claude-code
region: kanto
---

# Charmander

## Role

Backend specialist. Strong on async-task implementation, DB migrations, API
surface design. Does not do frontend or UI work.

## Conventions

- Always opens a worktree before touching code.
- Journals at end-of-task; `moves_used:` populated from session memory.
- Posts API-affecting changes to the appropriate progress channel.
- Refuses to merge to main (basic stage / restricted autonomy).
```

*Notice:* `moveset:` lists the moves this profile pulls in — it's the queryable contract. `evolution_stage: basic` is the starting stage; agents evolve over time through `vault_evolve-profile`. `autonomy_level: restricted` is one of three levels (restricted / feature-branch / merge-allowed) governing what the agent is permitted to do.

## `move` — a portable, runtime-agnostic skill

> A markdown skill file describing one technique an agent applies. **Authored once, deployed to multiple runtimes.** The format is the open SKILL.md standard shared by Claude Code, OpenClaw, Codex, and Gemini CLI.

**Use when** the technique is reusable across agents — TDD cycle, PR creation, debugging, channel coordination.

**Don't use when** you're describing *who* applies it (that's a `profile`) or *one specific instance* of having applied it (that's a `journal` entry).

**What one looks like** (excerpt from `moves/move-tdd-cycle/SKILL.md`):

```markdown
---
id: move-tdd-cycle
title: "TDD cycle"
type: move
wiki: _agents
status: active
name: tdd-cycle
description: "Use when implementing any feature or bugfix, before writing implementation code."
move_type: process
applies_to: [claude-code, openclaw, codex]
pokemon_type: ghost
tools_used: [Bash, Edit, Read, Grep, Glob, Write]
---

# TDD cycle

## When to use

Any time you're about to write or modify implementation code that has measurable
behavior.

## How to apply

1. **Write the failing test first.** ...
2. **Run the test.** Verify it fails for the right reason ...
3. **Write the minimal implementation.** ...
```

*Notice:* `applies_to: [claude-code, openclaw, codex]` is the portability declaration — this move runs unchanged on three runtimes. `name:` and `description:` are the open-standard SKILL.md fields that Claude Code uses to surface the skill at session start; the rest of the frontmatter (`pokemon_type`, `move_type`, `tools_used`) is vault-specific superset that other consumers ignore. The body uses the same standard `## When to use` / `## How to apply` headings consumers expect.

## Skill deployment — `vault_sync-skills`

A profile's moveset isn't useful sitting in `wikis/_agents/`. To put it where an agent runtime can find it, deploy with `vault_sync-skills`:

```bash
stoa sync-skills --profile=charmander --repo=/path/to/repo
```

This reads the named profile, walks its `moveset:` field, and for each move writes the SKILL.md into the target repo's `.claude/skills/<move-id>/SKILL.md`. The runtime adapter strips vault-specific frontmatter fields the consumer doesn't understand and emits a SKILL.md that conforms to the consumer's spec. After deployment, every Claude Code session in `<repo>` has the moveset's skills available.

### Portability story

> Today: Claude Code (`.claude/skills/`). Planned: **OpenClaw** — portable agent definitions sync to OpenClaw too, so you author once and deploy to multiple runtimes.

The SKILL.md format is already the **open standard shared by Claude Code, OpenClaw, Codex, and Gemini CLI**. A move's `applies_to:` field declares the runtimes it targets. The vault frontmatter is a *superset* of the open standard — runtime adapters strip what the target doesn't recognize. So:

- Authoring a move is a **one-time** cost.
- Deploying to a new runtime is a **transformation** step (runtime-adapter), not a re-authoring.
- A profile's moveset can be deployed to any runtime in its moves' `applies_to:` intersection.

This is the *portability* claim: agent definitions live in the vault as canonical source of truth; deploying them is a downhill transformation.

## Channels — agent-to-agent communication

A **channel** is a named coordination stream. Posts are journal entries with `channel: <name>` set in frontmatter; they're visible to other agent instances via `vault_channel-tail`. This is how one agent in repo A tells another agent in repo B that something happened.

```bash
# Post (e.g., from Repo A's agent after a breaking lib change)
stoa channel-post --channel=lib-foo-progress \
                  --content="v1.4.0 published — foo() return shape changed, see PR #42"

# Tail (e.g., from Repo B's agent on session start)
stoa channel-tail --channel=lib-foo-progress --since=2026-05-01T00:00Z
```

Default tail window is 24h. The response includes a `cursor` value — pass it back as `--since=<cursor>` next time for incremental polling without re-reading old posts.

The channels themselves are durable — they live as journal entries on disk, searchable via `recall`, lintable via `lint`. They're not a separate runtime; they're a tagging convention on top of the journal type.

## Tasks — agent-to-agent coordination of work

A **task** is a unit of pending work that any agent can claim. Tasks have status (`pending` / `in-progress` / `done`), an optional owner, and segregation tags for filtering. Claiming is **atomic via mtime optimistic concurrency**: only one agent wins; race-losers see `AlreadyClaimedError` with the actual claimer recorded.

```bash
# Create a task
stoa task-create --wiki=<name> \
                 --title="Refactor auth middleware" \
                 --segregation=auth-rewrite

# List pending tasks
stoa task-list --wiki=<name> --status=pending

# Claim atomically (returns the task or AlreadyClaimedError)
stoa task-claim <task-id> --as=<agent-id>

# Update status when done
stoa task-update <task-id> --status=done --notes="Landed in PR #57"
```

This is the same coordination pattern channels use (durable on-disk state, no separate runtime), specialized for *claim once, work, mark done* rather than *broadcast and tail*.

## Profile evolution

A profile's `id` may change as it evolves — e.g., `profile-charmander` → `profile-charmeleon` → `profile-charizard`. Each evolution renames the file and updates the `pokemon:` field; the **alias index** at `_index/aliases.json` preserves backwards refs so old `related:` links and journal attributions still resolve.

The Pokemon assigned to a profile is **rolled randomly at creation** and **locked** — direct edits to the `pokemon:` field are caught by `vault_lint` as `POKEMON_FIELD_TAMPERED`. Evolution via `vault_evolve-profile` is the only legal rename path. See stoa `docs/training-program.md` for the full evolution lifecycle (lived-claim thresholds, specialty clusters, operator review).

## See also

- Vault root `README.md` — the knowledge model (concepts, syntheses, decisions, lifecycle)
- Vault root `CLAUDE.md` — schema canon (frontmatter contract, behavioral contracts)
- stoa `docs/training-program.md` — profiles, moves, courses, trainers, evolution (operator workflow)
- stoa `docs/agent-memory.md` — the agent-memory tool (ranking, rendered output)
- stoa `docs/claims.md` — claims data model

---

*Doc ownership: this README owns the **agent substrate** — profiles, moves, the portability story, channels, tasks, and profile evolution. For the knowledge model see the vault root `README.md`. For install + tools see the stoa package README. For schema see the vault root `CLAUDE.md`.*
