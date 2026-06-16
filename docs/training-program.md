# Training program

Stoa lets you grow AI agents over time instead of starting them from scratch every session. A fresh profile has no context, makes no-op recalls, and works only as well as the system prompt you hand it. A trained profile has accumulated claims — scored, decay-aware beliefs about how work gets done in your wikis — that surface automatically at task-start. The training program is the set of mechanics that takes a profile from zero to useful, and from useful to specialized.

This doc covers profiles, moves, courses, trainers, and evolution. For the claims data model and the retrieval tool (`vault_agent-memory`) that makes claims available at task time, see [agent-memory.md](./agent-memory.md).

---

## Key concepts

**Profile.** A `profile-<pokemon>.md` page in `wikis/_agents/profiles/`. It declares the agent's name, evolution stage, moveset, and autonomy level. The profile is the stable identity — the same Pokemon everywhere, even when deployed to different repos.

**Move.** A skill or procedure described in a `SKILL.md` file under `wikis/_agents/moves/<id>/` (portable) or `wikis/<wiki>/moves/<id>/` (specialist). Moves tell the agent *how* to do specific things — TDD cycles, PR creation, channel coordination. `vault_sync` (`surface: agents`) assembles a profile's moveset into a `CLAUDE.md` fragment baked into the target repo.

**Course.** A `guide` page (`guide-course-<slug>.md`) with a structured lesson format: Read / Do / Claim to author on completion. Courses bootstrap fresh profiles past the cold-start problem by producing a set of curricular claims before the agent touches a real task.

**Claim.** A scored, decay-aware belief authored by an agent and stored in the vault. The building block of persistent memory. See [agent-memory.md](./agent-memory.md) for depth.

**Trainer.** A configuration entry (in `~/.vault/stadium.toml`) that controls which profiles a trainer owns, their accept policy, and the match/battle surface. Each trainer has a companion `trainer-<slug>.md` page in `wikis/_agents/trainers/`. The `vault_trainer-*` tools manage this surface.

**Evolution.** When a profile accumulates enough lived claims in a specialty cluster, `vault_evolve-profile` proposes a stage transition (`basic` → `stage1` → `stage2`), a rename to the next-stage Pokemon name, and moveset additions. The operator reviews and commits.

---

## Operator workflow: onboarding a fresh profile

### 1. Scaffold the profile page

Create `wikis/_agents/profiles/profile-<pokemon>.md` with the required frontmatter: `id`, `title`, `type: profile`, `wiki: _agents`, `evolution_stage: basic`, `moveset: []`, `autonomy_level: restricted`. Start it `status: draft`.

### 2. Find or write a course

Courses are discovery-indexed by their `guide-course-` filename prefix:

```
vault_recall  topic: "course"  wiki: "_agents"
```

If a suitable course exists, note its id. If not, author one — see [guide-authoring-a-course.md](../wikis/_agents/guides/guide-authoring-a-course.md) for the five-section body format and the `vault_claim` invocation shape each lesson uses. The canonical example is `guide-course-vault-mcp-onboarding`, a five-lesson course that seeds cold-start context for any profile entering the vault-mcp substrate.

### 3. Dispatch the agent to walk the course

Open a Claude Code session as (or for) the profile. Point it at the course page. The agent reads each lesson, does the exercise, and authors a curricular claim:

```
vault_claim
  as: "charmander"
  content: "Claims filter by scope_wiki at retrieval time..."
  scope_wiki: ["_agents"]
  tags: ["schema", "claims", "scope"]
  source_type: "curricular"
  evidence: ["[[guide-course-vault-mcp-onboarding]]"]
```

After each lesson the agent calls `vault_reindex` so the claim is indexed before the next lesson's retrieval check. By the end of the course the profile has 4-6 curricular claims in `_index/claims.json`.

### 4. Review the claims

```
vault_list-claims  profile: "charmander"  source_type: "curricular"
```

Confirm the expected claims landed and their content is coherent. Promote the profile's course claims from `draft` to `active` if they read correctly — this makes them available to `vault_agent-memory` at task time.

### 5. Deploy with vault_sync (surface: agents)

Once the profile is ready to work in a repo, deploy it:

```
vault_sync
  surface: "agents"
  repo_path: "/path/to/your/repo"
  pokemon: "charmander"
```

This reads Charmander's `profile-charmander.md`, collects its portable moveset from `wikis/_agents/moves/`, layers in any specialist moves from the target repo's wiki (`wikis/<wiki>/moves/`), and writes the result as a `CLAUDE.md` fragment in the target repo. The fragment includes the profile's system-prompt instructions, a `## Moveset` section listing every deployed move with its one-line description, and links back to the vault.

Sync is idempotent: running it again only writes when the source has changed (tracked via `source_revision` in `_index/deployments.json`).

---

## Moves in detail

Moves are the procedural half of a profile's identity. A portable move (`wikis/_agents/moves/move-tdd-cycle/SKILL.md`) is part of every deployment of that profile, regardless of which repo it lands in. A specialist move (`wikis/crewtracks-modules/moves/move-add-crewtracks-module/SKILL.md`) is layered in only when deploying to the wiki it's scoped to.

The deployed `CLAUDE.md` renders two subsections:

```markdown
### Portable moves
- move-tdd-cycle — Red-green-refactor with test-first discipline
- move-pr-create — Open a pull request from the current branch

### Specialist moves (crewtracks-modules)
- move-add-crewtracks-module — Scaffold a new feature module in the CrewTracks app
```

If no specialist moves exist for the target wiki, that subsection is omitted entirely.

One rule to remember: never add a specialist move's id to a profile's `moveset:` frontmatter. The deploy-time layering is the lever — the profile stays the same Pokemon everywhere.

For authoring specialist moves and the four lint codes that catch frontmatter drift, see [guide-using-wiki-local-moves.md](../wikis/_agents/guides/guide-using-wiki-local-moves.md).

---

## Evolution

Profiles start at `basic` stage. As an agent completes real tasks and authors lived claims, `vault_evolve-profile` watches for specialty clusters — tags that have accumulated enough high-confidence claim weight to indicate a genuine specialty.

Run it in proposal mode first (no changes written):

```
vault_evolve-profile
  pokemon_id: "charmander"
  commit: false
```

The response tells you whether the profile is eligible, what the proposed next stage is, which specialties were detected, and which moves to add or remove. If it looks right, commit:

```
vault_evolve-profile
  pokemon_id: "charmander"
  commit: true
  expected_updated: "<updated-value-from-proposal-call>"
  proposal: { ... }
```

The commit phase renames the profile file (e.g., `profile-charmander.md` → `profile-charmeleon.md`), updates the alias index so historical references still resolve, re-deploys to any repos recorded in `_index/deployments.json`, and removes the old per-deployment skills directory.

Curricular claims contribute to specialty clusters at half weight (`0.5×`). A profile that has only walked courses cannot clear the stage1 threshold by curricular evidence alone — real task completions are required. This keeps the evolution gate meaningful.

---

## Trainers

Trainers configure the dispatch and match surface: which profiles they own, acceptance criteria, and autonomy grants. Each trainer is a `[trainer.<slug>]` block in `~/.vault/stadium.toml` with a companion `trainer-<slug>.md` page in `wikis/_agents/trainers/`. The `vault_trainer-*` family of tools manages creation, listing, and matching.

If the trainer page and the toml block fall out of sync, `vault_lint --wiki=_agents` surfaces the mismatch via `TRAINER_FILE_MISSING`, `TRAINER_TOML_MISSING`, or `TRAINER_ID_MISMATCH` codes.

---

## From documentation to trained agents

The fastest way to bootstrap a profile on a new domain is to write the documentation first, then build a course from it, then dispatch the agent through the course.

**Step 1 — Write domain docs with a documentation agent.**

Use a documentation profile (e.g. profile-pidgey) to write user-facing docs covering the domain the target agent needs to understand. These become the reading material for the course:

```
vault_sync
  surface: "agents"
  repo_path: "/path/to/your/repo"
  pokemon: "pidgey"
```

Then ask pidgey to write `docs/training-program.md`, `docs/claims.md`, and similar pages. The resulting docs are grounded in the actual codebase and serve as accurate course reading material.

**Step 2 — Author a course that points at those docs.**

Create a `guide-course-<slug>.md` whose lessons reference the docs you just wrote. Each lesson's "Read" section links to a doc page; each lesson's "Claim to author" produces a concrete belief:

```markdown
### Lesson 1: The claims lifecycle

- **Read:** `docs/claims.md` sections "What a claim is" through "Lifecycle".
- **Do:** Author one test claim with `vault_claim`, then retract it with `retract: true`.
- **Claim to author on completion:**
  vault_claim  as: "<agent-id>"  content: "Claims decay at a 75-day half-life..."
  scope_wiki: ["_agents"]  tags: ["claims", "decay"]  source_type: "curricular"
```

**Step 3 — Dispatch the target agent through the course.**

Open a session as the target profile, point it at the course page, and let it walk each lesson. After all lessons are complete, run `vault_reindex` and review the authored claims with `vault_list-claims`.

**Why this works.** The documentation agent (pidgey) writes accurate, codebase-grounded material. The course translates that material into concrete exercises with verifiable claim outputs. The target agent ends the course with scored beliefs it will retrieve at task time via `vault_agent-memory`. No claims are invented — every belief traces back to a lesson exercise and the doc it references.

---

## Quick reference

| Tool | What it does |
|---|---|
| `vault_sync` (`surface: agents`) | Deploy a profile's moveset (portable + specialist) to a target repo. |
| `vault_evolve-profile` | Propose or commit a profile stage transition based on claim clusters. |
| `vault_profile-stats` | Return current claim counts, task counts, and specialty cluster summary for a profile. |
| `vault_suggest-pokemon` | Recommend a Pokemon name fitting a given specialty tag set. |
| `vault_real-skill` (`mode: register`) | Register a lived claim from a completed real task (writes + reindexes). |
| `vault_real-skill` (`mode: refresh`) | Revalidate an existing lived claim, resetting its decay clock. |
