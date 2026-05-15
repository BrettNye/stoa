# Common workflows

Task-driven recipes for the things you'll actually do once stoa is installed. Each scenario is independent — skim the table of contents and skip to what you need.

This doc assumes you've finished [`quickstart.md`](./quickstart.md) and have at least one wiki set as active.

A few conventions used below:

- `vault.<tool>` is the MCP tool name Claude Code will invoke. You can ask Claude in plain English ("capture this to inbox: …") or name the tool explicitly. Both work.
- "Active wiki" means whichever wiki is resolved from (in order): explicit `wiki:` argument, the `--default-wiki=<name>` flag on the server, or `.active-wiki` at the vault root.
- All paths are inside your vault root (`STOA_VAULT_PATH`).

## Scenarios

1. [Capture a fleeting idea without breaking flow](#scenario-capture-a-fleeting-idea-without-breaking-flow)
2. [Find what you wrote about a topic last week](#scenario-find-what-you-wrote-about-a-topic-last-week)
3. [Promote inbox items into typed pages](#scenario-promote-inbox-items-into-typed-pages)
4. [Switch which wiki is active](#scenario-switch-which-wiki-is-active)
5. [Use stoa from a different repo](#scenario-use-stoa-from-a-different-repo)
6. [Hand off context between Claude Code sessions](#scenario-hand-off-context-between-claude-code-sessions)
7. [Coordinate two Claude Code sessions on shared work](#scenario-coordinate-two-claude-code-sessions-on-shared-work)
8. [Compile multiple notes into one synthesis page](#scenario-compile-multiple-notes-into-one-synthesis-page)
9. [Queue work for another agent to pick up](#scenario-queue-work-for-another-agent-to-pick-up)
10. [Audit vault health](#scenario-audit-vault-health)
11. [Cold-start a session with full context](#scenario-cold-start-a-session-with-full-context)

---

## Scenario: Capture a fleeting idea without breaking flow

**You'll accomplish:** Drop a one-line thought into the vault without thinking about what type it is.

**Run:**

```
vault.inbox  thought: "obsidian's canvas might be the right surface for the map.md rollup view"
```

**What happened:** Stoa wrote a timestamped file to `wikis/<active>/inbox/2026-05-12-1430-obsidians-canvas-might-be.md` containing just the thought text. No frontmatter, no slug decisions, no commitment to a type. The inbox folder is the fast lane — items live here until you process them.

**When to use this:** Any time something occurs to you mid-task and you don't want to context-switch to file it properly. Aim to drain the inbox within a day or two so things don't accumulate.

**See also:** [Promote inbox items into typed pages](#scenario-promote-inbox-items-into-typed-pages).

---

## Scenario: Find what you wrote about a topic last week

**You'll accomplish:** Surface every page in the vault that touched a topic, with the highest-ranked synthesis inlined.

**Run:**

```
vault.recall  topic: "claim decay"
```

Add `wiki: <name>` to scope to one wiki. Add `layer: "all"` to include `task` and `journal` pages alongside knowledge pages (the default `layer: "knowledge"` excludes execution-layer noise).

**What happened:** Stoa scored every indexed page against the topic using stemmed token matching plus title/summary/tag boosts, then returned up to 20 hits sorted by score. The result is segmented by layer (knowledge first, execution second). If a matching `synthesis` page exists, its full body is returned alongside the hit list — recall is the one tool that reads content inline, because synthesis is where prior thinking actually lives.

**When to use this:** Before drafting any new spec, decision, or design. Before saying "let me think about this" — there's a good chance you already did, and the past-you-thinking is one tool call away.

**See also:** [Cold-start a session with full context](#scenario-cold-start-a-session-with-full-context), [Compile multiple notes into one synthesis page](#scenario-compile-multiple-notes-into-one-synthesis-page).

---

## Scenario: Promote inbox items into typed pages

**You'll accomplish:** Walk through accumulated inbox captures, decide a type for each, and file them properly.

**Run:** Two phases. First, list what's pending:

```
vault.process-inbox  commit: false
```

You get back a `proposals` array. Each proposal has the inbox path, a suggested type (defaults to `idea`), and a suggested id. Review them with Claude — accept, change the type, or drop items. Then commit the chosen promotions:

```
vault.process-inbox  commit: true  items: [
  { inbox_path: "wikis/notes/inbox/2026-05-12-1430-...md", type: "idea", id: "idea-canvas-as-map-rollup", title: "Canvas as map rollup" },
  { inbox_path: "wikis/notes/inbox/2026-05-12-1500-...md", type: "question", id: "question-decay-half-life-correct" }
]
```

**What happened:** For each `items[]` entry, stoa read the inbox file, attached minimal frontmatter (`id`, `title`, `type`, `wiki`, `status: draft`, `created`), wrote it to the right type folder (`ideas/`, `questions/`, `concepts/`, etc.), and deleted the original inbox file. All promoted pages start as `status: draft` — you promote to `active` or `accepted` later as they stabilize.

**When to use this:** Weekly at minimum. The inbox is intentionally low-friction at capture time; the cost is that *someone* has to file later, and that someone is you (or Claude, working from your decisions).

---

## Scenario: Switch which wiki is active

**You'll accomplish:** Change which wiki ambient calls (like `vault.inbox` and `vault.recall` without an explicit `wiki:`) target.

**Run:**

```
vault.set-active  wiki: "research"
```

**What happened:** Stoa wrote the string `research` to `.active-wiki` at the vault root. Every subsequent tool call that doesn't pass an explicit `wiki:` will resolve to `research` (unless the MCP server was launched with `--default-wiki=<name>`, which takes precedence).

**When to use this:** When you're switching contexts and don't want to keep typing `wiki: …` on every call. The resolution order is: explicit `wiki:` arg → `--default-wiki` flag → `.active-wiki` file → error.

**See also:** [Use stoa from a different repo](#scenario-use-stoa-from-a-different-repo) — per-repo `.mcp.json` is the better answer when each repo has a "home" wiki.

---

## Scenario: Use stoa from a different repo

**You'll accomplish:** Wire a repo so Claude Code sessions opened there default to the right wiki without manual `set-active` calls.

**Run:**

```
vault.bootstrap-repo  repo_path: "/abs/path/to/your/repo"  wiki: "your-project-wiki"
```

Optionally add `channels: ["your-project-progress", "your-project-requests"]` to declare coordination channels for the repo.

**What happened:** Stoa wrote (or merged) two files in the repo:

- `.mcp.json` — registers stoa as an MCP server for this repo, with `--default-wiki=<wiki>` baked into the args. This overrides user-scoped config when Claude Code opens this repo.
- `CLAUDE.md` — appends (or replaces, between marker comments) a fragment that tells Claude Code about the vault context, the active wiki, and the declared channels.

Existing entries in either file are preserved — bootstrap merges rather than clobbers.

**When to use this:** Any time you have a repo where the work belongs in one specific wiki. The bootstrap means contributors to that repo get the same vault context with zero config — `git clone` plus opening Claude Code is all it takes.

**See also:** [Coordinate two Claude Code sessions on shared work](#scenario-coordinate-two-claude-code-sessions-on-shared-work).

---

## Scenario: Hand off context between Claude Code sessions

**You'll accomplish:** Leave a written breadcrumb at end-of-task so the next session (yours, an hour from now, or someone else's tomorrow) can pick up without re-deriving.

**Run:**

```
vault.agent-journal  entry: "Finished the recall ranking spec. Open question: do we want title-match to dominate body-match or weight them evenly? Left in question-recall-ranking-weights."
```

Optional extras: `agent_id: "claude-code"` (default), `session_id: "<your-session-id>"`, `channel: "stoa-progress"` to make this entry visible to channel tails, `duration_minutes: 45`.

**What happened:** Stoa wrote a `journal` page to `wikis/<active>/journal/journal-2026-05-12-1430-finished-the-recall.md` with `author: agent:claude-code` and the entry as body. The index is updated immediately. Future `vault.recall` calls will find this journal entry alongside knowledge pages when its content matches.

**When to use this:** At the end of every non-trivial session, or whenever you'd otherwise leave a stale browser tab open as your reminder. Journals are the cross-session memory loop — they're what makes "what did I work on last Thursday" a tool call instead of a tab archaeology project.

**See also:** [Cold-start a session with full context](#scenario-cold-start-a-session-with-full-context).

---

## Scenario: Coordinate two Claude Code sessions on shared work

**You'll accomplish:** Two Claude Code sessions (different repos, different machines, doesn't matter) communicate without copy-paste.

**Run:** From session A, post the ask:

```
vault.channel-post  channel: "stoa-requests"  content: "Need a new `vault.find-orphans` tool that lists pages with zero inbound links. Blocking the cleanup pass."
```

From session B, read the channel:

```
vault.channel-tail  channel: "stoa-requests"  limit: 20
```

Optional: pass `since: "2026-05-12T00:00:00Z"` to get only entries after a timestamp. Stoa returns the matching entries plus a `cursor` you can pass back as `since` next time.

**What happened:** `vault.channel-post` is a thin wrapper over `vault.agent-journal` — the post becomes a journal entry with the `channel:` field set. `vault.channel-tail` queries the index for journal entries with that channel field, optionally filtered by timestamp. Channel names must match `^[a-z0-9]+(-[a-z0-9]+)*$` (lowercase letters, digits, hyphen-separated). Posts are durable — they live in the vault as plain Markdown, not in a transient queue.

**When to use this:** Whenever two sessions need to talk and you don't want a Slack channel for it. Common patterns: lib-progress / lib-requests channel pairs between a library repo and its consumers; per-feature coordination channels during a multi-session push.

**See also:** [Queue work for another agent to pick up](#scenario-queue-work-for-another-agent-to-pick-up), [Use stoa from a different repo](#scenario-use-stoa-from-a-different-repo).

---

## Scenario: Compile multiple notes into one synthesis page

**You'll accomplish:** Roll N scattered pages on a topic into one synthesis page that future-you reads instead of re-reading the N.

**Run:**

```
vault.synthesize  topic: "recall ranking"  wiki: "stoa"
```

Optional: pass `inputs: ["concept-token-stemming", "decision-2026-04-01-title-boost", ...]` to scope the synthesis to a specific page set rather than letting stoa search for matches.

**What happened:** Stoa found every page in the wiki matching the topic, generated a synthesis page at `wikis/<wiki>/synthesis/synthesis-recall-ranking.md` with `last_compiled: <today>`, listed the inputs cited, and (if Claude provided `prose:` text) inlined that prose. Running this command again on the same topic overwrites the existing synthesis page — synthesis is intentionally re-runnable, not append-only.

**When to use this:** When `vault.recall` returns 3+ substantive pages on a topic with no synthesis covering them. Also after authoring a new `decision` — refreshing the topic's synthesis closes the loop so the decision is reflected in what future-you reads.

**See also:** [Find what you wrote about a topic last week](#scenario-find-what-you-wrote-about-a-topic-last-week).

---

## Scenario: Queue work for another agent to pick up

**You'll accomplish:** Drop a task into the vault that another Claude Code session (or you, later) can find and claim atomically.

**Run:** Create the task:

```
vault.task-create  title: "Write failing test for recall title-boost rule"  wiki: "stoa"  description: "title token-match should outweigh body token-match by ~2x. Need a unit test that pins the ratio."  channel: "stoa-progress"
```

List pending tasks:

```
vault.task-list  status: "pending"  wiki: "stoa"
```

Claim one (from any session, including the same one). You need the task's current `updated` timestamp from the list call:

```
vault.task-claim  task_id: "task-write-failing-test-for-recall-title-boost-rule"  agent_id: "claude-code"  expected_updated: "<the-updated-value-from-task-list>"
```

If two sessions race for the same task, only one wins — the loser sees `AlreadyClaimedError`. The `expected_updated` is mtime optimistic concurrency: stoa checks it matches the file's current mtime before claiming, so stale claims fail cleanly.

Update the task as you progress:

```
vault.task-update  task_id: "task-..."  wiki: "stoa"  expected_updated: "<latest-updated>"  status: "in_progress"  notes: "Test scaffold landed; debugging the score-difference assertion."
```

**What happened:** `vault.task-create` wrote a `task` page to `wikis/<wiki>/tasks/` with `status: pending`. `vault.task-claim` flipped it to `status: claimed` and stamped `claimed_by: agent:<agent_id>` and `assigned_at`. `vault.task-update` mutates the task's frontmatter and (optionally) body notes, all via mtime-OCC writes so concurrent updates don't silently overwrite.

**When to use this:** When you have work that can be done independently and you want a durable queue. Especially useful for "I'll do this later" parking — drop the task, move on, find it next session via `vault.task-list` with `status: "pending"`.

**See also:** [Coordinate two Claude Code sessions on shared work](#scenario-coordinate-two-claude-code-sessions-on-shared-work).

---

## Scenario: Audit vault health

**You'll accomplish:** Surface drift, schema violations, broken cross-wiki links, and synthesis debt without changing anything.

**Run:**

```
vault.lint
```

Add `wiki: <name>` to scope to one wiki, or `level: "error"` to only see hard violations (default is `warning`, which includes both errors and warnings; `info` includes everything).

**What happened:** Stoa ran every registered lint check against the indexed pages and (where the check needs it) the on-disk files. You get back `diagnostics: [...]` (each with `code`, `severity`, `message`, and the path that triggered it) plus a `summary: { errors, warnings, info }`. Lint never mutates anything — it surfaces suggestions; you decide what to fix.

**When to use this:** Weekly is a good cadence. Also before a big curation pass — lint will tell you which drafts have aged into the "needs attention" range and which syntheses haven't been recompiled in a while.

**See also:** [Promote inbox items into typed pages](#scenario-promote-inbox-items-into-typed-pages), [Compile multiple notes into one synthesis page](#scenario-compile-multiple-notes-into-one-synthesis-page).

---

## Scenario: Cold-start a session with full context

**You'll accomplish:** Open Claude Code after time away and immediately get a brief on what's active, what's recent, and what's waiting on you.

**Run:**

```
vault.start  wiki: "stoa"
```

Optional: pass `topics: ["recall-ranking", "claim-decay"]` to also run recall on those topics as part of the brief, or `since: "2026-05-10T00:00:00Z"` to scope channel activity to entries newer than that timestamp (default is last 24h).

**What happened:** Stoa read the wiki's `map.md` (first 25 lines, since the top of the map is the curated section), walked the wiki for pages in `status: active` or `accepted` and summarized up to 20 of them, computed unread counts on whatever channels are declared as tailed, and returned the lot as one structured brief. If you pass `pokemon: <name>`, stoa also looks up that agent profile and returns its current in-flight tasks.

**When to use this:** First call of any non-trivial session, especially when re-engaging a wiki cold. It's the answer to "where was I?" without re-reading your own notes.

**See also:** [Find what you wrote about a topic last week](#scenario-find-what-you-wrote-about-a-topic-last-week), [Hand off context between Claude Code sessions](#scenario-hand-off-context-between-claude-code-sessions).

---

## Habits worth building

- **Capture into inbox; classify later.** The fast lane is intentional. Don't think about types at capture time.
- **Recall before drafting.** Before any new spec, decision, or design — run `vault.recall <topic>` first. There's a good chance you've already thought about this.
- **Journal at end-of-task.** One sentence is enough. Future-you will thank present-you.
- **Run lint weekly.** It's the early-warning system for drift.
- **Synthesize when a topic hits 3+ pages.** The synthesis is what compounds.

For the design rationale behind these conventions, see the [`README.md`](../README.md) in this repo and the vault's `CLAUDE.md`.
