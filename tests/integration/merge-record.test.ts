// Phase-3 T3-2 — `vault_merge-record` integration tests.
//
// The tool wraps `core/merge-record.composeMergeJournal` + `computeTaskTransition`
// with three IO concerns:
//   1. alias-overlay resolution of `agent_id` (spec §7.5)
//   2. journal file write under `wikis/_agents/journal/`
//   3. conditional task transition for `status === "merged"` only
//
// Each test seeds a fresh fixture vault from scratch.

import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reindex } from "../../src/core/reindex.js";
import { recordRename } from "../../src/core/aliases.js";
import { parseFrontmatter } from "../../src/core/frontmatter.js";
import { mergeRecordTool, __setNowFnForTests } from "../../src/tools/merge-record.js";
import { UnknownAgentError } from "../../src/core/merge-record.js";

let vault: string;

function writeProfile(vaultPath: string, profileId: string, fields: Record<string, any> = {}): void {
  const dir = join(vaultPath, "wikis", "_agents", "profiles");
  mkdirSync(dir, { recursive: true });
  const fm = [
    "---",
    `id: ${profileId}`,
    `title: ${fields.title ?? profileId}`,
    "type: profile",
    "wiki: _agents",
    "status: active",
    `created: ${fields.created ?? "2026-04-30"}`,
    `updated: ${fields.updated ?? "2026-04-30"}`,
    `summary: ${fields.summary ?? "test profile"}`,
    `pokemon_type: ${fields.pokemon_type ?? "fire"}`,
    `evolution_stage: ${fields.evolution_stage ?? "basic"}`,
    `autonomy_level: ${fields.autonomy_level ?? "restricted"}`,
    "moveset: []",
    "applies_to:",
    "  - claude-code",
    "---"
  ].join("\n");
  writeFileSync(join(dir, `${profileId}.md`), `${fm}\n# ${profileId}\n`);
}

function writeTask(
  vaultPath: string, wiki: string, id: string, fields: Record<string, any>
): void {
  const dir = join(vaultPath, "wikis", wiki, "tasks");
  mkdirSync(dir, { recursive: true });
  const lines = [
    "---",
    `id: ${id}`,
    `title: ${fields.title ?? id}`,
    "type: task",
    `wiki: ${wiki}`,
    `status: ${fields.status ?? "claimed"}`,
    `created: ${fields.created ?? "2026-04-30"}`,
    `updated: ${fields.updated ?? "2026-04-30"}`,
    `summary: ${fields.summary ?? id}`
  ];
  if (fields.channel) lines.push(`channel: ${fields.channel}`);
  if (fields.claimed_by) lines.push(`claimed_by: ${fields.claimed_by}`);
  lines.push("---");
  writeFileSync(join(dir, `${id}.md`), `${lines.join("\n")}\n# ${id}\n`);
}

function seedVault(): string {
  const v = mkdtempSync(join(tmpdir(), "vault-mr-"));
  mkdirSync(join(v, "_index"), { recursive: true });
  // _agents wiki for profile + journal output
  mkdirSync(join(v, "wikis", "_agents", "journal"), { recursive: true });
  writeFileSync(
    join(v, "wikis", "_agents", "CLAUDE.md"),
    "# _agents\n\n**Mode:** coordination\n"
  );
  writeFileSync(
    join(v, "wikis", "_agents", "map.md"),
    "---\nid: map-_agents\ntype: map\ntitle: Agents\ncreated: 2026-04-30\n---\nMap.\n"
  );
  // alpha wiki for tasks
  mkdirSync(join(v, "wikis", "alpha"), { recursive: true });
  writeFileSync(
    join(v, "wikis", "alpha", "CLAUDE.md"),
    "# alpha\n\n**Mode:** coordination\n"
  );
  writeFileSync(
    join(v, "wikis", "alpha", "map.md"),
    "---\nid: map-alpha\ntype: map\ntitle: Alpha\ncreated: 2026-04-30\n---\nMap.\n"
  );
  return v;
}

describe("phase-3 T3-2 — vault_merge-record tool", () => {
  afterEach(() => {
    __setNowFnForTests(undefined);
    if (vault) rmSync(vault, { recursive: true, force: true });
  });

  it("status=merged + task_id: writes journal, updates task to completed, task_updated=true", async () => {
    vault = seedVault();
    writeProfile(vault, "profile-charmander");
    writeTask(vault, "alpha", "task-do-thing", {
      channel: "feat-charmander-progress",
      status: "claimed",
      claimed_by: "agent:charmander"
    });
    await reindex(vault);

    const result = await mergeRecordTool.handler(
      {
        pr_number: 42,
        channel: "feat-charmander-progress",
        agent_id: "charmander",
        merge_commit_sha: "abc123",
        status: "merged",
        task_id: "task-do-thing"
      },
      { vaultPath: vault }
    );

    expect(result.journal_id).toMatch(/^journal-\d{4}-\d{2}-\d{2}-\d{4}-merge-42-merged$/);
    expect(result.task_updated).toBe(true);
    expect(typeof result.recorded_at).toBe("string");

    // Journal file exists at expected path
    const journalPath = join(vault, "wikis", "_agents", "journal", `${result.journal_id}.md`);
    expect(existsSync(journalPath)).toBe(true);
    const raw = readFileSync(journalPath, "utf8");
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.author).toBe("agent:charmander");
    expect(frontmatter.pr_number).toBe(42);
    expect(frontmatter.status).toBe("merged");

    // Task was transitioned to completed
    const taskPath = join(vault, "wikis", "alpha", "tasks", "task-do-thing.md");
    const taskRaw = readFileSync(taskPath, "utf8");
    const { frontmatter: taskFm } = parseFrontmatter(taskRaw);
    expect(taskFm.status).toBe("completed");
  });

  it("status=merged + no task_id: journal written, task_updated=false", async () => {
    vault = seedVault();
    writeProfile(vault, "profile-charmander");
    await reindex(vault);

    const result = await mergeRecordTool.handler(
      {
        pr_number: 7,
        channel: "feat-charmander-progress",
        agent_id: "charmander",
        status: "merged"
      },
      { vaultPath: vault }
    );

    expect(result.task_updated).toBe(false);
    const journalPath = join(vault, "wikis", "_agents", "journal", `${result.journal_id}.md`);
    expect(existsSync(journalPath)).toBe(true);
  });

  it("status=failed + task_id: journal written, task NOT touched, task_updated=false", async () => {
    vault = seedVault();
    writeProfile(vault, "profile-charmander");
    writeTask(vault, "alpha", "task-do-thing", {
      channel: "feat-charmander-progress",
      status: "claimed",
      claimed_by: "agent:charmander"
    });
    await reindex(vault);

    const result = await mergeRecordTool.handler(
      {
        pr_number: 13,
        channel: "feat-charmander-progress",
        agent_id: "charmander",
        status: "failed",
        task_id: "task-do-thing",
        notes: "build broke"
      },
      { vaultPath: vault }
    );

    expect(result.task_updated).toBe(false);
    const journalPath = join(vault, "wikis", "_agents", "journal", `${result.journal_id}.md`);
    expect(existsSync(journalPath)).toBe(true);
    const { frontmatter } = parseFrontmatter(readFileSync(journalPath, "utf8"));
    expect(frontmatter.status).toBe("failed");

    // Task status unchanged
    const taskPath = join(vault, "wikis", "alpha", "tasks", "task-do-thing.md");
    const { frontmatter: taskFm } = parseFrontmatter(readFileSync(taskPath, "utf8"));
    expect(taskFm.status).toBe("claimed");
  });

  it("status=halted-conflict + task_id: journal written, task NOT touched", async () => {
    vault = seedVault();
    writeProfile(vault, "profile-charmander");
    writeTask(vault, "alpha", "task-do-thing", {
      channel: "feat-charmander-progress",
      status: "claimed",
      claimed_by: "agent:charmander"
    });
    await reindex(vault);

    const result = await mergeRecordTool.handler(
      {
        pr_number: 14,
        channel: "feat-charmander-progress",
        agent_id: "charmander",
        status: "halted-conflict",
        task_id: "task-do-thing"
      },
      { vaultPath: vault }
    );

    expect(result.task_updated).toBe(false);
    const taskPath = join(vault, "wikis", "alpha", "tasks", "task-do-thing.md");
    const { frontmatter: taskFm } = parseFrontmatter(readFileSync(taskPath, "utf8"));
    expect(taskFm.status).toBe("claimed");
  });

  it("status=halted-red-ci: journal written, no task transition", async () => {
    vault = seedVault();
    writeProfile(vault, "profile-charmander");
    writeTask(vault, "alpha", "task-do-thing", {
      channel: "feat-charmander-progress",
      status: "claimed",
      claimed_by: "agent:charmander"
    });
    await reindex(vault);

    const result = await mergeRecordTool.handler(
      {
        pr_number: 15,
        channel: "feat-charmander-progress",
        agent_id: "charmander",
        status: "halted-red-ci",
        task_id: "task-do-thing"
      },
      { vaultPath: vault }
    );

    expect(result.task_updated).toBe(false);
    const journalPath = join(vault, "wikis", "_agents", "journal", `${result.journal_id}.md`);
    expect(existsSync(journalPath)).toBe(true);
    const taskPath = join(vault, "wikis", "alpha", "tasks", "task-do-thing.md");
    const { frontmatter: taskFm } = parseFrontmatter(readFileSync(taskPath, "utf8"));
    expect(taskFm.status).toBe("claimed");
  });

  it("alias resolution: historical agent_id resolves to current canonical id in journal author", async () => {
    vault = seedVault();
    // Profile starts as charmander, then renamed to charmeleon.
    writeProfile(vault, "profile-charmeleon");
    recordRename(vault, "profile-charmander", "profile-charmeleon");
    await reindex(vault);

    const result = await mergeRecordTool.handler(
      {
        pr_number: 1,
        channel: "feat-fire-progress",
        agent_id: "charmander", // historical name
        status: "merged"
      },
      { vaultPath: vault }
    );

    const journalPath = join(vault, "wikis", "_agents", "journal", `${result.journal_id}.md`);
    expect(existsSync(journalPath)).toBe(true);
    const { frontmatter } = parseFrontmatter(readFileSync(journalPath, "utf8"));
    expect(frontmatter.author).toBe("agent:charmeleon");
  });

  it("unknown agent_id: throws UnknownAgentError; no journal file written", async () => {
    vault = seedVault();
    // No profile, no alias.
    await reindex(vault);

    await expect(
      mergeRecordTool.handler(
        {
          pr_number: 99,
          channel: "feat-ghost-progress",
          agent_id: "ghost-agent",
          status: "merged"
        },
        { vaultPath: vault }
      )
    ).rejects.toThrow(UnknownAgentError);

    // No merge-99 journal should have been written.
    const journalDir = join(vault, "wikis", "_agents", "journal");
    const list = existsSync(journalDir) ? readdirSync(journalDir) : [];
    const merge99 = list.find(f => f.includes("merge-99"));
    expect(merge99).toBeUndefined();
  });

  it("disk-scan fallback: task created on disk after last reindex still resolves and transitions", async () => {
    vault = seedVault();
    writeProfile(vault, "profile-charmander");
    // Reindex BEFORE the task exists, so the index does NOT know about it.
    await reindex(vault);
    // Now create the task on disk (simulates direct file authoring between
    // reindexes — the scenario that surfaced the bug in Phase-3 Wave 5 T5-3).
    writeTask(vault, "alpha", "task-disk-only", {
      channel: "feat-charmander-progress",
      status: "claimed",
      claimed_by: "agent:charmander"
    });
    // Deliberately do NOT reindex.

    const result = await mergeRecordTool.handler(
      {
        pr_number: 77,
        channel: "feat-charmander-progress",
        agent_id: "charmander",
        merge_commit_sha: "deadbeef",
        status: "merged",
        task_id: "task-disk-only"
      },
      { vaultPath: vault }
    );

    expect(result.task_updated).toBe(true);

    // Task file on disk has been transitioned to completed.
    const taskPath = join(vault, "wikis", "alpha", "tasks", "task-disk-only.md");
    const { frontmatter: taskFm } = parseFrontmatter(readFileSync(taskPath, "utf8"));
    expect(taskFm.status).toBe("completed");
  });

  it("disk-scan fallback: task truly missing → task_updated=false but journal still written", async () => {
    vault = seedVault();
    writeProfile(vault, "profile-charmander");
    await reindex(vault);

    const result = await mergeRecordTool.handler(
      {
        pr_number: 78,
        channel: "feat-charmander-progress",
        agent_id: "charmander",
        status: "merged",
        task_id: "task-does-not-exist"
      },
      { vaultPath: vault }
    );

    expect(result.task_updated).toBe(false);
    // Journal IS still written — the journal is the rule of record.
    const journalPath = join(vault, "wikis", "_agents", "journal", `${result.journal_id}.md`);
    expect(existsSync(journalPath)).toBe(true);
  });

  it("idempotent re-run: same now + same input → same journal_id, file overwritten safely", async () => {
    vault = seedVault();
    writeProfile(vault, "profile-charmander");
    await reindex(vault);

    // Pin `now` so both calls produce the same journal_id.
    const fixedNow = "2026-04-30T15:55:27.000Z";
    __setNowFnForTests(() => fixedNow);

    const r1 = await mergeRecordTool.handler(
      {
        pr_number: 50,
        channel: "feat-charmander-progress",
        agent_id: "charmander",
        status: "merged"
      },
      { vaultPath: vault }
    );
    const r2 = await mergeRecordTool.handler(
      {
        pr_number: 50,
        channel: "feat-charmander-progress",
        agent_id: "charmander",
        status: "merged"
      },
      { vaultPath: vault }
    );

    expect(r1.journal_id).toBe(r2.journal_id);
    expect(r1.recorded_at).toBe(r2.recorded_at);
    const journalPath = join(vault, "wikis", "_agents", "journal", `${r1.journal_id}.md`);
    expect(existsSync(journalPath)).toBe(true);
  });
});
