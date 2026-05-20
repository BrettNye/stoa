# Stoa docs

These docs ship inside the npm package as of v0.3 — after `npm i -g @stoa-mcp/cli`, they live at `<npm-global>/node_modules/@stoa-mcp/cli/docs/`. They are also browsable on GitHub.

## Start here

- [`installation.md`](./installation.md) — install the CLI, wire the MCP server into your AI client, point it at a vault path.
- [`quickstart.md`](./quickstart.md) — your first useful `vault_recall` in 5 minutes.

## Daily and weekly use

- [`common-workflows.md`](./common-workflows.md) — task-driven recipes: capturing, finding, syncing across repos, multi-agent coordination.
- [`daily-habits.md`](./daily-habits.md) — the ~1-hour-a-month maintenance loop that keeps a vault worth reading.
- [`tool-reference.md`](./tool-reference.md) — alphabetical reference for every `vault_*` MCP tool.

## Agent substrate (profiles, moves, training)

- [`training-program.md`](./training-program.md) — how to grow agents over time: profiles, moves, courses, trainers, evolution. **Start here when building your first agent.**
- [`agent-memory.md`](./agent-memory.md) — identity-keyed working context: `vault_agent-memory` and how it pulls an agent's accumulated claims at decision time.
- [`claims.md`](./claims.md) — the vault's unit of durable belief. How agents learn from work and apply learnings on subsequent dispatches.
- [`task-coordination.md`](./task-coordination.md) — distributing units of work across agents via the global task queue.
- [`wait-for.md`](./wait-for.md) — push primitives for cross-process event coordination without polling.

## Operations

- [`manual-smoke-test.md`](./manual-smoke-test.md) — pre-release end-to-end cross-repo verification.

---

For schema canon, design rationale, and the broader knowledge model, see the project [`README.md`](../README.md) at the package root.
