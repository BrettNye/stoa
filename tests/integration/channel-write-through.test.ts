import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { postToChannel, tailChannel } from "../../src/core/channel.js";
import { reindex } from "../../src/core/reindex.js";
import { loadIndex } from "../../src/core/index.js";
import { agentJournalTool } from "../../src/tools/agent-journal.js";
import { newTool } from "../../src/tools/new.js";
import { taskCreateTool } from "../../src/tools/task-create.js";
import { taskUpdateTool } from "../../src/tools/task-update.js";
import { mergeRecordTool, __setNowFnForTests as setMergeRecordNowFn } from "../../src/tools/merge-record.js";

describe("channel write-through (T2-1 fix)", () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-cwt-"));
    mkdirSync(join(vaultPath, "wikis", "alpha", "journal"), { recursive: true });
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    writeFileSync(join(vaultPath, "_index", "aliases.json"), "{}");
    await reindex(vaultPath);
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("postToChannel makes the entry immediately visible to tailChannel — no manual reindex needed", async () => {
    await postToChannel(vaultPath, { channel: "feat-x", content: "first", wiki: "alpha", agent_id: "charmander" });
    const r = tailChannel(vaultPath, { channel: "feat-x", since: "2026-01-01" });
    expect(r.entries.length).toBe(1);
    expect(r.entries[0].body).toContain("first");
  });

  it("two consecutive posts both visible without reindex", async () => {
    await postToChannel(vaultPath, { channel: "feat-x", content: "first", wiki: "alpha", agent_id: "charmander" });
    await postToChannel(vaultPath, { channel: "feat-x", content: "second", wiki: "alpha", agent_id: "charmander" });
    const r = tailChannel(vaultPath, { channel: "feat-x", since: "2026-01-01" });
    expect(r.entries.length).toBe(2);
  });
});

// v1.7 §5.1 — page write-through invariant for the remaining five tools.
// Spec contract: every page-write path must call upsertPage so the new/changed
// entry appears in `_index/pages.json` (and `tokens.json`/`wikis.json`)
// without a manual reindex. Each test below writes a page through the tool
// then asserts the entry is visible via `loadIndex`.

describe("vault.new write-through (v1.7 §5.1)", () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-new-wt-"));
    mkdirSync(join(vaultPath, "wikis", "alpha", "concepts"), { recursive: true });
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    writeFileSync(join(vaultPath, "_index", "aliases.json"), "{}");
    await reindex(vaultPath);
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("vault.new makes the new page immediately visible via loadIndex — no manual reindex needed", async () => {
    const result = await newTool.handler(
      { type: "concept", wiki: "alpha", title: "Write-through new test", status: "draft" },
      { vaultPath }
    );
    const idx = loadIndex(vaultPath);
    expect(idx.pages.some(p => p.id === result.id)).toBe(true);
  });
});

describe("agent-journal write-through (v1.7 §5.1)", () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-aj-wt-"));
    mkdirSync(join(vaultPath, "wikis", "alpha", "journal"), { recursive: true });
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    writeFileSync(join(vaultPath, "_index", "aliases.json"), "{}");
    await reindex(vaultPath);
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("agent-journal write makes the new entry immediately visible via loadIndex — no manual reindex needed", async () => {
    const result = await agentJournalTool.handler(
      { entry: "write-through verification entry", wiki: "alpha", agent_id: "charmander" },
      { vaultPath }
    );
    const idx = loadIndex(vaultPath);
    expect(idx.pages.some(p => p.id === result.id)).toBe(true);
  });
});

describe("vault.task-create write-through (v1.7 §5.1)", () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-tc-wt-"));
    mkdirSync(join(vaultPath, "wikis", "alpha", "tasks"), { recursive: true });
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    writeFileSync(join(vaultPath, "_index", "aliases.json"), "{}");
    await reindex(vaultPath);
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("task-create makes the new task immediately visible via loadIndex — no manual reindex needed", async () => {
    const result = await taskCreateTool.handler(
      { title: "Write-through task create", wiki: "alpha" },
      { vaultPath }
    );
    const idx = loadIndex(vaultPath);
    expect(idx.pages.some(p => p.id === result.id && p.type === "task")).toBe(true);
  });
});

describe("vault.task-update write-through (v1.7 §5.1)", () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-tu-wt-"));
    mkdirSync(join(vaultPath, "wikis", "alpha", "tasks"), { recursive: true });
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    writeFileSync(join(vaultPath, "_index", "aliases.json"), "{}");
    await reindex(vaultPath);
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("task-update makes the changed task status immediately visible via loadIndex — no manual reindex needed", async () => {
    const created = await taskCreateTool.handler(
      { title: "Write-through task update", wiki: "alpha" },
      { vaultPath }
    );

    // Confirm pre-update status is "pending" in the index (write-through from create).
    const idxBefore = loadIndex(vaultPath);
    const beforeEntry = idxBefore.pages.find(p => p.id === created.id);
    expect(beforeEntry).toBeDefined();
    expect((beforeEntry as any).status).toBe("pending");

    await taskUpdateTool.handler(
      {
        task_id: created.id,
        wiki: "alpha",
        expected_updated: created.updated,
        status: "in_progress"
      },
      { vaultPath }
    );

    const idxAfter = loadIndex(vaultPath);
    const afterEntry = idxAfter.pages.find(p => p.id === created.id);
    expect(afterEntry).toBeDefined();
    expect((afterEntry as any).status).toBe("in_progress");
  });
});

describe("vault.merge-record write-through (v1.7 §5.1)", () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-mr-wt-"));
    // _agents wiki for journal + profile.
    mkdirSync(join(vaultPath, "wikis", "_agents", "journal"), { recursive: true });
    mkdirSync(join(vaultPath, "wikis", "_agents", "profiles"), { recursive: true });
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    writeFileSync(join(vaultPath, "_index", "aliases.json"), "{}");

    // Minimal profile so resolveAgentId in merge-record finds the agent.
    writeFileSync(
      join(vaultPath, "wikis", "_agents", "profiles", "profile-charmander.md"),
      `---
id: profile-charmander
title: Charmander
type: profile
wiki: _agents
status: active
created: 2026-04-29
updated: 2026-04-29
pokemon_name: charmander
pokemon_type: fire
evolution_stage: basic
---
Charmander profile.
`
    );
    await reindex(vaultPath);
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    setMergeRecordNowFn(undefined);
  });

  it("merge-record makes the new journal entry immediately visible via loadIndex — no manual reindex needed", async () => {
    const result = await mergeRecordTool.handler(
      {
        pr_number: 42,
        channel: "feat-x",
        agent_id: "charmander",
        status: "merged",
        merge_commit_sha: "abc123def456"
      },
      { vaultPath }
    );
    const idx = loadIndex(vaultPath);
    expect(idx.pages.some(p => p.id === result.journal_id)).toBe(true);
  });
});
