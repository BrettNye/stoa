// Phase-3 T3-1 — `vault_merge-queue` integration tests.
//
// The tool is a pure read: tail a coordination channel for `ready: branch=...`
// signals, list tasks scoped to the resolved wiki/family, map ready PRs to
// their source tasks via `branch_suffix`, and topo-sort by `task.blocking`.
// Pure logic lives in `core/merge-queue.ts` (Wave 1 T1-1); this layer wires
// channel-tail + task-list + family-resolution to it.
//
// Each test seeds a fixture vault from scratch (no shared `copyFixtureVault`),
// then exercises the tool through its handler — same path the MCP server takes.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reindex } from "../../src/core/reindex.js";
import { mergeQueueTool } from "../../src/tools/merge-queue.js";

let vault: string;

function writeJournal(
  vaultPath: string,
  wiki: string,
  id: string,
  channel: string,
  author: string,
  created: string,
  body: string
): void {
  const dir = join(vaultPath, "wikis", wiki, "journal");
  mkdirSync(dir, { recursive: true });
  const fm = [
    "---",
    `id: ${id}`,
    `title: Journal ${id}`,
    "type: journal",
    `wiki: ${wiki}`,
    `created: ${created}`,
    `author: ${author}`,
    `channel: ${channel}`,
    "---"
  ].join("\n");
  writeFileSync(join(dir, `${id}.md`), `${fm}\n${body}\n`);
}

function writeTask(
  vaultPath: string,
  wiki: string,
  id: string,
  fields: Record<string, any>
): void {
  const dir = join(vaultPath, "wikis", wiki, "tasks");
  mkdirSync(dir, { recursive: true });
  const lines = ["---", `id: ${id}`, `title: ${fields.title ?? id}`, "type: task", `wiki: ${wiki}`];
  lines.push(`status: ${fields.status ?? "pending"}`);
  lines.push(`created: ${fields.created ?? "2026-04-30"}`);
  lines.push(`updated: ${fields.updated ?? "2026-04-30"}`);
  lines.push(`summary: ${fields.summary ?? id}`);
  if (fields.channel) lines.push(`channel: ${fields.channel}`);
  if (fields.branch_suffix) lines.push(`branch_suffix: ${fields.branch_suffix}`);
  if (fields.claimed_by) lines.push(`claimed_by: ${fields.claimed_by}`);
  if (Array.isArray(fields.blocking)) {
    if (fields.blocking.length === 0) {
      lines.push("blocking: []");
    } else {
      lines.push("blocking:");
      for (const b of fields.blocking) lines.push(`  - ${b}`);
    }
  }
  lines.push("---");
  writeFileSync(join(dir, `${id}.md`), `${lines.join("\n")}\n# ${id}\n`);
}

function seedSingleWikiVault(): string {
  const v = mkdtempSync(join(tmpdir(), "vault-mq-"));
  mkdirSync(join(v, "_index"), { recursive: true });
  mkdirSync(join(v, "wikis", "alpha"), { recursive: true });
  writeFileSync(
    join(v, "wikis", "alpha", "CLAUDE.md"),
    "# alpha\n\n**Mode:** coordination\n**Scope:** test\n"
  );
  writeFileSync(
    join(v, "wikis", "alpha", "map.md"),
    "---\nid: map-alpha\ntype: map\ntitle: Alpha\ncreated: 2026-04-30\n---\nMap.\n"
  );
  return v;
}

describe("phase-3 T3-1 — vault_merge-queue tool", () => {
  afterEach(() => {
    if (vault) rmSync(vault, { recursive: true, force: true });
  });

  it("three ready PRs with linear blocking → dependency_order respects task chain", async () => {
    vault = seedSingleWikiVault();
    const channel = "feat-foo-progress";

    // Three tasks: a → b → c (b blocks c, a blocks b). Linear chain.
    writeTask(vault, "alpha", "task-a", {
      channel, branch_suffix: "a", status: "claimed",
      claimed_by: "agent:charmander", blocking: []
    });
    writeTask(vault, "alpha", "task-b", {
      channel, branch_suffix: "b", status: "claimed",
      claimed_by: "agent:squirtle", blocking: ["task-a"]
    });
    writeTask(vault, "alpha", "task-c", {
      channel, branch_suffix: "c", status: "claimed",
      claimed_by: "agent:bulbasaur", blocking: ["task-b"]
    });
    // Extra task with no ready signal: should appear in unready_prs.
    writeTask(vault, "alpha", "task-d", {
      channel, branch_suffix: "d", status: "claimed",
      claimed_by: "agent:pikachu", blocking: []
    });

    // Three ready signals in arbitrary post order; dependency order should
    // override post order. PRs: a=#2, b=#5, c=#3.
    writeJournal(vault, "alpha", "journal-2026-04-30-1000-r-b", channel,
      "agent:squirtle", "2026-04-30T10:00:00Z",
      "ready: branch=feat/foo/b PR-5");
    writeJournal(vault, "alpha", "journal-2026-04-30-1100-r-c", channel,
      "agent:bulbasaur", "2026-04-30T11:00:00Z",
      "ready: branch=feat/foo/c PR-3");
    writeJournal(vault, "alpha", "journal-2026-04-30-1200-r-a", channel,
      "agent:charmander", "2026-04-30T12:00:00Z",
      "ready: branch=feat/foo/a PR-2");

    await reindex(vault);

    const result = await mergeQueueTool.handler(
      { channel, wiki: "alpha", since: "2026-01-01T00:00:00Z" },
      { vaultPath: vault }
    );

    expect(result.feature).toBe("foo");
    expect(result.ready_prs).toHaveLength(3);
    for (const pr of result.ready_prs) {
      expect(pr.ci_status).toBe("unknown");
    }
    expect(result.unready_prs).toHaveLength(1);
    expect(result.unready_prs[0].task_id).toBe("task-d");
    // a (#2) → b (#5) → c (#3): task chain dictates order.
    expect(result.dependency_order).toEqual([2, 5, 3]);
  });

  it("ready PR without a matching task → task_id null + warning", async () => {
    vault = seedSingleWikiVault();
    const channel = "feat-bar-progress";

    writeTask(vault, "alpha", "task-real", {
      channel, branch_suffix: "real", status: "claimed",
      claimed_by: "agent:charmander", blocking: []
    });
    writeJournal(vault, "alpha", "journal-2026-04-30-1000-real", channel,
      "agent:charmander", "2026-04-30T10:00:00Z",
      "ready: branch=feat/bar/real PR-1");
    // Orphan ready signal — no task with branch_suffix=ghost.
    writeJournal(vault, "alpha", "journal-2026-04-30-1100-ghost", channel,
      "agent:squirtle", "2026-04-30T11:00:00Z",
      "ready: branch=feat/bar/ghost PR-99");

    await reindex(vault);

    const result = await mergeQueueTool.handler(
      { channel, wiki: "alpha", since: "2026-01-01T00:00:00Z" },
      { vaultPath: vault }
    );

    expect(result.ready_prs).toHaveLength(2);
    const orphan = result.ready_prs.find(p => p.pr_number === 99);
    expect(orphan).toBeDefined();
    expect(orphan!.task_id).toBeNull();
    expect(orphan!.blocking).toEqual([]);
    const warned = result.warnings.some(w => w.includes("PR #99") && w.includes("no matching task"));
    expect(warned).toBe(true);
  });

  it("cyclic blocking → cycle warning + cycle PRs appended last in dependency_order", async () => {
    vault = seedSingleWikiVault();
    const channel = "feat-cycle-progress";

    writeTask(vault, "alpha", "task-x", {
      channel, branch_suffix: "x", status: "claimed",
      claimed_by: "agent:charmander", blocking: ["task-y"]
    });
    writeTask(vault, "alpha", "task-y", {
      channel, branch_suffix: "y", status: "claimed",
      claimed_by: "agent:squirtle", blocking: ["task-x"]
    });

    writeJournal(vault, "alpha", "journal-2026-04-30-1000-x", channel,
      "agent:charmander", "2026-04-30T10:00:00Z",
      "ready: branch=feat/cycle/x PR-10");
    writeJournal(vault, "alpha", "journal-2026-04-30-1100-y", channel,
      "agent:squirtle", "2026-04-30T11:00:00Z",
      "ready: branch=feat/cycle/y PR-11");

    await reindex(vault);

    const result = await mergeQueueTool.handler(
      { channel, wiki: "alpha", since: "2026-01-01T00:00:00Z" },
      { vaultPath: vault }
    );

    expect(result.ready_prs).toHaveLength(2);
    expect(result.dependency_order).toContain(10);
    expect(result.dependency_order).toContain(11);
    const cycleWarned = result.warnings.some(w => w.toLowerCase().includes("cycle"));
    expect(cycleWarned).toBe(true);
  });

  it("recovery: merge-record journal on channel is filtered out, not parsed as ready signal", async () => {
    vault = seedSingleWikiVault();
    const channel = "feat-recovery-test-progress";

    // One task with branch_suffix=recovery on the recovery channel.
    writeTask(vault, "alpha", "task-recovery", {
      channel, branch_suffix: "recovery", status: "claimed",
      claimed_by: "agent:bulbasaur", blocking: []
    });

    // Real ready signal posted by bulbasaur for PR #10.
    writeJournal(vault, "alpha", "journal-2026-05-01-0623-ready-pr10", channel,
      "agent:bulbasaur", "2026-05-01T06:23:00Z",
      "ready: branch=feat/recovery-test/recovery PR-10");

    // Merge-record outcome on the SAME channel: halted-conflict for PR #10
    // posted by mewtwo. Body contains both `## Ready signal` H2 and `**PR:** #10`,
    // which would trip the regex pass without the id-prefix filter.
    writeJournal(vault, "alpha", "journal-2026-05-01-0640-merge-10-halted-conflict", channel,
      "agent:mewtwo", "2026-05-01T06:40:00Z",
      "# Merge PR #10 — halted-conflict\n\n**PR:** #10\n**Branch:** feat/recovery-test/recovery\n**Status:** halted-conflict\n\n## Ready signal\n[[wikis/_agents/journal/journal-2026-05-01-0623-ready-pr10]]\n\n## What happened\nConflict on shared.txt");

    await reindex(vault);

    const result = await mergeQueueTool.handler(
      { channel, wiki: "alpha", since: "2026-01-01T00:00:00Z" },
      { vaultPath: vault }
    );

    expect(result.ready_prs).toHaveLength(1);
    expect(result.ready_prs[0].pr_number).toBe(10);
    expect(result.ready_prs[0].author).toBe("agent:bulbasaur");
    expect(result.warnings).toEqual([]);
  });

  it("findOnDisk fallback: ready-signal journal on disk but not in idx still surfaces (v1.7 §5.4)", async () => {
    vault = seedSingleWikiVault();
    const channel = "feat-fallback-progress";

    // Task with branch_suffix=fallback, claimed by charmander.
    writeTask(vault, "alpha", "task-fallback", {
      channel, branch_suffix: "fallback", status: "claimed",
      claimed_by: "agent:charmander", blocking: []
    });

    // Reindex: at this point pages.json knows about the task only.
    await reindex(vault);

    // NOW write the ready-signal journal on disk WITHOUT reindexing again.
    // The index-based tailChannel will not see this entry.
    writeJournal(vault, "alpha", "journal-2026-05-01-1200-ready-pr42", channel,
      "agent:charmander", "2026-05-01T12:00:00Z",
      "ready: branch=feat/fallback/fallback PR-42");

    const result = await mergeQueueTool.handler(
      { channel, wiki: "alpha", since: "2026-01-01T00:00:00Z" },
      { vaultPath: vault }
    );

    // With findOnDisk fallback: the on-disk journal is recovered, the ready
    // signal is parsed, and the PR shows up in ready_prs with author resolved.
    expect(result.ready_prs).toHaveLength(1);
    expect(result.ready_prs[0].pr_number).toBe(42);
    expect(result.ready_prs[0].task_id).toBe("task-fallback");
    expect(result.ready_prs[0].author).toBe("agent:charmander");
  });

  it("family: filter pulls tasks + journals across all family members", async () => {
    vault = mkdtempSync(join(tmpdir(), "vault-mq-fam-"));
    mkdirSync(join(vault, "_index"), { recursive: true });

    // Two-member family: rastate-core + rastate-dev. Both declare family: rastate.
    for (const member of ["rastate-core", "rastate-dev"]) {
      mkdirSync(join(vault, "wikis", member), { recursive: true });
      writeFileSync(
        join(vault, "wikis", member, "CLAUDE.md"),
        `# ${member}\n\nfamily: rastate\nmode: coordination\n`
      );
      writeFileSync(
        join(vault, "wikis", member, "map.md"),
        `---\nid: map-${member}\ntype: map\ntitle: ${member}\ncreated: 2026-04-30\nwiki: ${member}\nstatus: active\nsummary: m\nupdated: 2026-04-30\n---\nMap.\n`
      );
    }

    const channel = "feat-shared-progress";

    // Task in rastate-core, journal in rastate-dev — wired via shared channel.
    writeTask(vault, "rastate-core", "task-core", {
      channel, branch_suffix: "core", status: "claimed",
      claimed_by: "agent:charmander", blocking: []
    });
    writeTask(vault, "rastate-dev", "task-dev", {
      channel, branch_suffix: "dev", status: "claimed",
      claimed_by: "agent:squirtle", blocking: ["task-core"]
    });

    writeJournal(vault, "rastate-core", "journal-2026-04-30-1000-core", channel,
      "agent:charmander", "2026-04-30T10:00:00Z",
      "ready: branch=feat/shared/core PR-1");
    writeJournal(vault, "rastate-dev", "journal-2026-04-30-1100-dev", channel,
      "agent:squirtle", "2026-04-30T11:00:00Z",
      "ready: branch=feat/shared/dev PR-2");

    await reindex(vault);

    const result = await mergeQueueTool.handler(
      { channel, family: "rastate", since: "2026-01-01T00:00:00Z" },
      { vaultPath: vault }
    );

    expect(result.feature).toBe("shared");
    expect(result.ready_prs).toHaveLength(2);
    const taskIds = new Set(result.ready_prs.map(p => p.task_id));
    expect(taskIds.has("task-core")).toBe(true);
    expect(taskIds.has("task-dev")).toBe(true);
    // task-core blocks task-dev → PR-1 (core) before PR-2 (dev).
    expect(result.dependency_order).toEqual([1, 2]);
  });
});
