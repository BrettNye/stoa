---
id: guide-course-vault-mcp-onboarding
title: "Course: stoa onboarding for a fresh profile"
type: guide
wiki: _agents
status: active
summary: "Cold-start course for a freshly-spawned profile entering the stoa substrate. Teaches the agent-memory <-> claim feedback loop, the move/profile model, scope semantics, and how to author a first claim with source_type: curricular."
tags: [course, onboarding, agents, agent-memory, claims, vault]
---

# Course: stoa onboarding for a fresh profile

## Overview

This is the canonical first course for a freshly-spawned profile. A new profile has zero claims, so `vault_agent-memory` returns nothing useful for its first several sessions — the cold-start problem. Walking this course gives the agent a starting set of curricular claims plus a working mental model of how the substrate fits together.

The audience is any new Pokemon profile (basic stage, no prior task history) about to be dispatched into a real wiki. It teaches the note-type schema, the profile/moveset model, claims as decaying memory, the agent-memory feedback loop, and the portable-moves contract that keeps a profile coherent across repos.

By the end the agent will have authored five curricular claims that `vault_agent-memory` will surface on its first real task, plus the conceptual vocabulary to read what comes back.

## Prerequisites

- No prior courses required — this is the entry point.
- The agent must have been spawned with a `profile-<pokemon>.md` page already in `wikis/_agents/profiles/`.
- The agent must have read its own profile page and `wikis/_agents/CLAUDE.md` before starting Lesson 1.
- Helpful but not required: a top-to-bottom skim of vault root `CLAUDE.md` for the canonical schema contract, and the stoa training-program docs (see See also).

## Lessons

### Lesson 1: The type schema and scope dimensions

- **Read:** Vault root `CLAUDE.md` "The 11 note types, three layers" through "Frontmatter contract"; the stoa training-program docs section on profiles and moves.
- **Do:** Enumerate the canonical note types and group them by layer (knowledge / execution / navigation / substrate). For each type, identify what scope dimensions it can carry — which types take `scope_wiki:`, which take `wiki:` only, which (claims) carry multiple scope fields at once. Identify which type each of this course's five exit claims belongs to.
- **Claim to author on completion:**

  ```
  vault_claim \
    --as=<agent-id> \
    --content="Claims filter by scope_wiki at retrieval time; the agent-memory tool's wiki-scope guard is non-negotiable and silently drops cross-wiki claims even at high confidence." \
    --scope-wiki=_agents \
    --tags=schema,claims,scope \
    --source-type=curricular \
    --evidence="[[guide-course-vault-mcp-onboarding]]"
  ```

### Lesson 2: The profile + moveset model

- **Read:** [[wikis/_agents/profiles/profile-charmander]], [[wikis/_agents/CLAUDE.md]] (especially "Local conventions" and the moves subfolder description).
- **Do:** Open profile-charmander. Identify Charmander's full moveset (four portable moves). For each move, decide whether it is portable (lives under `wikis/_agents/moves/`) or specialist (would live under `wikis/<wiki>/moves/`). Then construct a counter-example: name one move that you would expect to find in a specialist wiki's `moves/` directory (e.g. `move-add-my-module`) and explain in one sentence why it does NOT belong in Charmander's profile frontmatter.
- **Claim to author on completion:**

  ```
  vault_claim \
    --as=<agent-id> \
    --content="Profile moveset frontmatter lists portable moves only; specialist (wiki-local) moves are layered in at bootstrap-repo time and never named in profile frontmatter." \
    --scope-wiki=_agents \
    --tags=profile,moveset,portability \
    --source-type=curricular \
    --evidence="[[guide-course-vault-mcp-onboarding]]"
  ```

### Lesson 3: Claims as decaying memory

- **Read:** stoa `docs/claims.md` (frontmatter contract, lifecycle, decay function).
- **Do:** Author one curricular claim explicitly using `vault_claim --source-type=curricular --evidence="[[guide-course-vault-mcp-onboarding]]"`. Confirm the claim file landed under the appropriate `claim/` directory and that `_index/claims.json` picked it up via `vault_reindex`. Note the 75-day default half-life that begins ticking from `created`. Inspect the `by_source_type` bucket and confirm your new claim appears under `curricular`.
- **Claim to author on completion:**

  ```
  vault_claim \
    --as=<agent-id> \
    --content="Claims are evidence-backed: curricular claims cite the course guide page; lived claims cite real journal entries, task pages, or PRs; retro claims cite the older artifacts the pattern was extracted from." \
    --scope-wiki=_agents \
    --tags=claims,evidence,source-type \
    --source-type=curricular \
    --evidence="[[guide-course-vault-mcp-onboarding]]"
  ```

### Lesson 4: The agent-memory feedback loop

- **Read:** stoa `docs/agent-memory.md` (ranking formula, rendered output shape).
- **Do:** Call `vault_agent-memory --agent-id=<your-id>` and observe the rendered output. Note the per-claim source_type tag in the bracket prefix (e.g. `[lived | 0.87]`, `[curricular | 0.62]`). Confirm that the claim you authored in Lesson 3 appears in the output. Calculate by hand the `effective_confidence x scope_match` ranking score for one claim and verify it against the rendered rank order. Confirm that source_type does NOT enter the ranking formula — a high-confidence curricular claim and a high-confidence lived claim with the same scope match should rank identically.
- **Claim to author on completion:**

  ```
  vault_claim \
    --as=<agent-id> \
    --content="vault_agent-memory ranks claims by effective_confidence x scope_match; ranking ignores source_type, but the rendered output tags each claim with its source_type so the caller can calibrate trust between taught and lived evidence." \
    --scope-wiki=_agents \
    --tags=agent-memory,ranking,source-type \
    --source-type=curricular \
    --evidence="[[guide-course-vault-mcp-onboarding]]"
  ```

### Lesson 5: The portable-moves contract

- **Read:** stoa `docs/training-program.md` (especially the section on portable vs specialist moves), and the deployment layering description in `wikis/_agents/CLAUDE.md`.
- **Do:** Imagine a specialist move `move-add-my-module` living in `wikis/<your-wiki>/moves/` and contrast its location with `move-tdd-cycle` under `wikis/_agents/moves/`. Explain in one sentence why `move-add-my-module` belongs in your wiki's `moves/` directory and not in `wikis/_agents/moves/`. Then explain in a second sentence why this folder placement, not a profile frontmatter edit, is the lever that gets the move into a deployed agent's skill set.
- **Claim to author on completion:**

  ```
  vault_claim \
    --as=<agent-id> \
    --content="The portable-moves contract is preserved by layering specialist moves in at deploy time (bootstrap-repo reads wikis/<wiki>/moves/) rather than by mutating profile moveset frontmatter; the profile stays the same Pokemon everywhere, only the deployed layer differs by repo." \
    --scope-wiki=_agents \
    --tags=moves,portability,bootstrap,contract \
    --source-type=curricular \
    --evidence="[[guide-course-vault-mcp-onboarding]]"
  ```

## Exit criteria

- Five claims authored, each citing `[[guide-course-vault-mcp-onboarding]]` as evidence with `source_type: curricular`.
- All five claims indexed under the `curricular` bucket of `_index/claims.json` after a `vault_reindex`.
- `vault_agent-memory --agent-id=<your-id>` returns the five new claims in its rendered output, each tagged `[curricular | <score>]`.
- (Optional) The dispatching trainer reviews and promotes the agent's draft claims to `active`.
- (Optional) The agent completes one real task in any wiki that cites at least one of the curricular claims as related evidence — that promotes the agent from "course-only" to "course-plus-lived" and seeds the first claim cluster `vault_evolve-profile` will weigh.

## See also

- stoa `docs/training-program.md` — profiles, moves, courses, trainers, evolution (operator workflow).
- stoa `docs/agent-memory.md` — the agent-memory tool (ranking, rendered output, scope semantics).
- stoa `docs/claims.md` — claims spec (frontmatter, decay, supersession).
- [[wikis/_agents/CLAUDE.md]] — _agents wiki conventions including the course body format and source-type weights.
- [[wikis/_agents/README.md]] — agent substrate overview (profiles, moves, channels, tasks, evolution).
