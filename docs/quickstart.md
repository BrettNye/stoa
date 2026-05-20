# Quickstart — your first useful recall in 5 minutes

This guide assumes stoa is installed and registered with Claude Code. If not, run through [`installation.md`](./installation.md) first, then come back.

By the end you'll have:

- A vault Claude Code can read and write to from any repo.
- A wiki to capture into.
- A real page on disk, found by `vault_recall` from a separate Claude Code session.

All steps are run as Claude Code tool calls. Talk to Claude in plain English (*"capture this to inbox: …"*) or invoke the tools by name. Both work.

---

## 1. Confirm the connection

In any Claude Code session, ask:

> List the wikis in my vault using `vault_list-wikis`.

You should see a JSON-ish list of wiki names with page counts. If you get "tool not found" or an empty result with no wikis, go back to [`installation.md`](./installation.md) and verify `STOA_VAULT_PATH` and that the server restarted.

## 2. Scaffold a wiki

A *wiki* is one folder under `wikis/` with its own scope and tag vocabulary. Start with one. Ask Claude:

> Create a new wiki named `notes`, mode `idea-map`, scope "personal scratch space for ideas and decisions", using `vault_new-wiki`.

Claude calls `vault_new-wiki` with `{ name: "notes", mode: "idea-map", scope: "personal scratch space..." }`. Stoa writes `wikis/notes/` with starter `map.md`, `log.md`, `CLAUDE.md`, and the standard subfolders (`concepts/`, `decisions/`, `ideas/`, `inbox/`, etc.).

The four modes are `idea-map`, `project-doc`, `learning`, `mixed`. Pick `idea-map` if you're not sure — it's the most permissive.

## 3. Make it the active wiki

So future calls don't need an explicit `wiki:` argument:

> Run `vault_set-active` with `wiki: notes`.

Stoa writes `.active-wiki` at the vault root. From now on, `vault_inbox` and friends default to `notes` when you don't say otherwise.

## 4. Capture a thought

> Run `vault_inbox` with thought "stoa's recall reads matching synthesis content inline, which is the move-the-needle feature".

Stoa writes a timestamped file under `wikis/notes/inbox/`. No frontmatter, no slug decisions, no thinking about types. That's the whole point of the inbox path — it's the fast lane.

You'll get back something like:

```
{ id: "2026-05-12-1430-stoas-recall-reads-matching", path: ".../wikis/notes/inbox/2026-05-12-1430-...", wiki: "notes" }
```

## 5. Create a typed page

Inbox items are good for fleeting captures. For something you want to find later, use `vault_new`:

> Run `vault_new` with type `concept`, wiki `notes`, title "How recall ranks hits".

Stoa creates `wikis/notes/concepts/concept-how-recall-ranks-hits.md` with frontmatter pre-filled (`id`, `title`, `type`, `wiki`, `created`, `status: draft`). Edit the body in your text editor, or ask Claude to draft the body for you.

## 6. Reindex (only if you edited files on disk)

If Claude Code created the page via `vault_new`, the index is already updated — stoa does a write-through update so the page is searchable immediately. If you hand-edited a file outside Claude Code (in Obsidian, VS Code, etc.), run:

> Run `vault_reindex`.

This regenerates `_index/pages.json`, `_index/tokens.json`, `_index/links.json`, and `_index/wikis.json`. Without it, `vault_recall` won't see your manual changes.

## 7. Recall — the payoff

Open a *different* Claude Code session, in a different repo. Ask:

> Use `vault_recall` to find pages about "recall ranks hits".

You should see your concept page in the results, with `score`, `status`, `summary`, and `updated`. If the page was a `synthesis`, recall would inline its full body — that's the bit that earns the tool its name.

---

## What you just built

You now have one wiki, one inbox item, and one typed page — all on local disk as plain Markdown. Every Claude Code session on this machine can read and write it. Tomorrow's session won't have forgotten today's.

## What to do next

- Read [`common-workflows.md`](./common-workflows.md) for task-by-task recipes (capturing, finding, syncing across repos, multi-agent coordination, etc.).
- Run `vault_lint` once a week to surface drift before it accumulates.
- Compile your first synthesis once you have 3+ related pages on a topic — `vault_synthesize` with `topic: "your topic"` rolls them up into one page.
