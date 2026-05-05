---
# `claim` page template — instantiated by `vault.new claim <wiki> "<title>"`.
#
# Placeholders the renderer substitutes:
#   {{slug}}   → kebab-case slug derived from the title
#   {{title}}  → human-readable title (the second positional arg)
#   {{date}}   → today's ISO date (YYYY-MM-DD)
#   {{wiki}}   → the wiki the claim belongs to (first positional arg)
#   {{author}} → caller identity, e.g. agent:profile-charmander or human:brett
#
# Tier note: this template emits `status: draft`, the loosest tier. Promote to
# `active` only when wiki/summary/updated/authored_by are all populated.

id: claim-{{slug}}
title: "{{title}}"
type: claim
created: "{{date}}"
status: draft

# Structured key (kebab-case, 2-4 dot-separated segments). Replace before
# promoting to active. Examples:
#   move.pr-create.requires-remote-preflight
#   profile.charmander.refuses-merge-to-main
key: "subject.domain"

# First-class scope dimensions. Empty array = global on this dimension.
# Populate any subset to narrow which agents/contexts the claim applies to.
profile: []
move: []
scope_wiki: []
tags: []

# Confidence in [0, 1]. 0.7 is a reasonable starting point for a fresh claim;
# raise it as evidence accumulates, lower it on near-misses.
confidence: 0.7
last_validated: "{{date}}"

# Authorship + provenance. `evidence:` is a list of wikilinks to journal,
# decision, or source pages that back this claim.
authored_by: "{{author}}"
evidence: []

# Supersession (only set on status: superseded).
supersedes: []
superseded_by: null

# Retraction (only set on status: retracted).
retracted_at: null
retracted_by: null
retraction_reason: null

# Standard vault frontmatter. `summary` and `updated` become required when
# this claim is promoted to status: active.
wiki: "{{wiki}}"
summary: ""
updated: "{{date}}"
---

<!--
Claim body: 1-3 sentences explaining the assertion. Keep prose under ~280
characters when possible — this is what `vault.sync-skills` will render into
the deployed SKILL.md, and longer prose gets truncated or wraps awkwardly in
agent context windows.

Good claims are atomic: one assertion, one scope, one piece of evidence per
line in `evidence:`. If you're tempted to write "and also...", split it into
a second claim instead.
-->

State the claim here in 1-3 sentences (~280 chars max).
