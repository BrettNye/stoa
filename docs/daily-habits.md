# Daily habits

A vault that isn't maintained drifts: inbox items pile up, drafts stagnate, syntheses go stale, and the index diverges from what's on disk. None of these are crises on their own, but they compound. The habits below add up to roughly an hour a month and keep the vault worth reading.

---

## Daily (~5 min)

- At session start on a new topic, run `vault.recall <current-topic>` once to re-orient. One call is enough — trust your in-session memory after that.
- If the inbox is non-empty, drain it with `vault.process-inbox`. Items shouldn't sit longer than a day or two.
- To get a structured brief on everything active — recent journals, open tasks, channel activity — run `vault.start` at cold-start.

The daily cadence is a session-start habit, not a per-task one. Running `vault.recall` before every sub-task wastes the context budget and adds noise. Orient once, then work.

---

## Weekly (~20 min)

- Run `vault.synthesize <topic>` for whichever topic dominated the week's work. This is the highest-leverage habit in the vault: synthesis compounds, individual notes don't.
- Walk the draft backlog. For each `status: draft` page, decide: promote to `active`, archive it, or leave a note on why it's still draft. Drafts that age without curation become noise.
- Run `vault.lint` and triage the warnings. The two that fire most often are `SYNTHESIS_DEBT` (topic with 3+ substantive pages but no synthesis) and `MISSING_CURATION_PRIORITY` (draft page past a reasonable age without disposition). Both are signals, not errors — act on them or consciously defer.

---

## Monthly (~30 min)

- Refresh syntheses where `last_compiled` is more than 60 days old. New decisions and concepts written since the last compile are invisible to anyone reading the synthesis. Run `vault.synthesize <topic>` to regenerate.
- Check the lint warning trend across active wikis. The count going up over several weeks is the signal to do a curation pass, not to add more pages.
- Walk top-level claims that aren't scoped to a specific wiki and verify they still reflect your current thinking. This is the cross-domain drift check — the vault's long-term coherence depends on it more than any single-wiki cleanup does.

---

## Before any creative or design work

- Run `vault.recall <topic>` before drafting a new spec, decision, or design. There is a good chance you've already thought about this; the prior thinking is one tool call away. If you consciously diverge from what recall surfaces, that's fine — but start from knowing what's there.

This is the preflight habit. Skipping it is how you end up with two specs for the same problem written six weeks apart by the same person.

---

## After significant edits

- If you edited files outside Claude Code — in Obsidian, VS Code, or a text editor — run `vault.reindex` before the next `vault.recall`. The index is not watched; it only updates when stoa writes the file or you reindex explicitly. Stale index means stale search results.

When stoa itself creates or edits pages (via `vault.new`, `vault.process-inbox`, `vault.synthesize`, etc.), the index is updated in the same operation. Manual edits are the only case that requires an explicit reindex.

---

## What to skip

- **Don't recall on every sub-task.** `vault.recall` is a session-start and preflight habit. Running it mid-task, before every note, or as a reflex adds latency without improving outcomes.
- **The vault doesn't need to capture everything.** Some thinking is best left off the record. Capturing for the sake of capturing degrades the signal-to-noise ratio of recall results and makes the weekly backlog walk harder. Capture when you expect to want it back.

---

## See also

- [quickstart.md](./quickstart.md) — set up the vault and make your first recall
- [common-workflows.md](./common-workflows.md) — the "Audit vault health" scenario covers `vault.lint` in detail
- [tool-reference.md](./tool-reference.md) — full parameter reference for every tool mentioned here
