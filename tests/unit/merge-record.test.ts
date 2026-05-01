import { describe, it, expect } from "vitest";
import {
  composeMergeJournal,
  computeTaskTransition,
  UnknownAgentError,
  type MergeRecordInput
} from "../../src/core/merge-record.js";

const baseInput: MergeRecordInput = {
  pr_number: 42,
  channel: "feat-charmander-progress",
  agent_id: "agent:charmander",
  status: "merged",
  now: "2026-04-30T15:55:27.000Z"
};

describe("composeMergeJournal — id format", () => {
  it("derives YYYY-MM-DD-HHMM from now (UTC) for merged status", () => {
    const out = composeMergeJournal({ ...baseInput });
    expect(out.journal_id).toBe("journal-2026-04-30-1555-merge-42-merged");
  });

  it("includes status suffix for halted-conflict", () => {
    const out = composeMergeJournal({
      ...baseInput,
      status: "halted-conflict"
    });
    expect(out.journal_id.endsWith("-merge-42-halted-conflict")).toBe(true);
  });

  it("zero-pads single-digit month/day/hour/minute", () => {
    const out = composeMergeJournal({
      ...baseInput,
      pr_number: 7,
      now: "2026-01-05T03:07:00.000Z"
    });
    expect(out.journal_id).toBe("journal-2026-01-05-0307-merge-7-merged");
  });
});

describe("composeMergeJournal — frontmatter", () => {
  it("sets type=journal, wiki=_agents, author=agent_id", () => {
    const out = composeMergeJournal({ ...baseInput });
    expect(out.frontmatter.type).toBe("journal");
    expect(out.frontmatter.wiki).toBe("_agents");
    expect(out.frontmatter.author).toBe(baseInput.agent_id);
  });

  it("id frontmatter equals computed journal_id", () => {
    const out = composeMergeJournal({ ...baseInput });
    expect(out.frontmatter.id).toBe(out.journal_id);
  });

  it("created equals input.now ISO string", () => {
    const out = composeMergeJournal({ ...baseInput });
    expect(out.frontmatter.created).toBe(baseInput.now);
  });

  it("channel equals input.channel", () => {
    const out = composeMergeJournal({ ...baseInput });
    expect(out.frontmatter.channel).toBe(baseInput.channel);
  });

  it("pr_number and status mirror input", () => {
    const out = composeMergeJournal({ ...baseInput });
    expect(out.frontmatter.pr_number).toBe(42);
    expect(out.frontmatter.status).toBe("merged");
  });

  it("tags include 'merge' and feature derived from channel", () => {
    const out = composeMergeJournal({ ...baseInput });
    expect(out.frontmatter.tags).toEqual(expect.arrayContaining(["merge", "charmander"]));
  });

  it("merge_commit_sha key present only when input provides it", () => {
    const without = composeMergeJournal({ ...baseInput });
    expect("merge_commit_sha" in without.frontmatter).toBe(false);

    const withSha = composeMergeJournal({ ...baseInput, merge_commit_sha: "abc123" });
    expect(withSha.frontmatter.merge_commit_sha).toBe("abc123");
  });

  it("task_id key present only when input provides it", () => {
    const without = composeMergeJournal({ ...baseInput });
    expect("task_id" in without.frontmatter).toBe(false);

    const withTask = composeMergeJournal({ ...baseInput, task_id: "task-do-thing" });
    expect(withTask.frontmatter.task_id).toBe("task-do-thing");
  });
});

describe("composeMergeJournal — body", () => {
  it("contains '**Merge commit:** <sha>' for merged status with sha", () => {
    const out = composeMergeJournal({
      ...baseInput,
      merge_commit_sha: "abc123"
    });
    expect(out.body).toContain("**Merge commit:** abc123");
  });

  it("contains '## What happened' section for halted-conflict", () => {
    const out = composeMergeJournal({
      ...baseInput,
      status: "halted-conflict"
    });
    expect(out.body).toContain("## What happened");
  });

  it("contains '## What happened' section for failed", () => {
    const out = composeMergeJournal({
      ...baseInput,
      status: "failed"
    });
    expect(out.body).toContain("## What happened");
  });

  it("contains '## What happened' section for halted-red-ci", () => {
    const out = composeMergeJournal({
      ...baseInput,
      status: "halted-red-ci"
    });
    expect(out.body).toContain("## What happened");
  });

  it("includes wikilink to ready_signal_journal_id when provided", () => {
    const out = composeMergeJournal({
      ...baseInput,
      ready_signal_journal_id: "journal-2026-04-29-0900-foo-ready"
    });
    expect(out.body).toContain(
      "[[wikis/_agents/journal/journal-2026-04-29-0900-foo-ready]]"
    );
  });

  it("contains notes verbatim when provided on merged status", () => {
    const out = composeMergeJournal({
      ...baseInput,
      notes: "all CI green"
    });
    expect(out.body).toContain("all CI green");
  });

  it("contains '**Branch:** <branch>' when branch provided", () => {
    const out = composeMergeJournal({
      ...baseInput,
      branch: "feat/charmander/api"
    });
    expect(out.body).toContain("**Branch:** feat/charmander/api");
  });

  it("header includes pr_number and status", () => {
    const out = composeMergeJournal({ ...baseInput });
    expect(out.body).toContain("# Merge PR #42");
    expect(out.body).toContain("merged");
  });
});

describe("composeMergeJournal — channel-to-feature derivation", () => {
  it("strips feat- prefix and -progress suffix", () => {
    const out = composeMergeJournal({
      ...baseInput,
      channel: "feat-charmander-progress"
    });
    expect(out.frontmatter.tags).toEqual(expect.arrayContaining(["charmander"]));
  });

  it("uses channel name verbatim when not feat-*-progress", () => {
    const out = composeMergeJournal({
      ...baseInput,
      channel: "random-name"
    });
    expect(out.frontmatter.tags).toEqual(expect.arrayContaining(["random-name"]));
  });
});

describe("computeTaskTransition", () => {
  it("returns transition for merged + task_id", () => {
    const t = computeTaskTransition({
      ...baseInput,
      task_id: "task-do-thing"
    });
    expect(t).toEqual({ task_id: "task-do-thing", new_status: "completed" });
  });

  it("returns null for merged with no task_id", () => {
    expect(computeTaskTransition({ ...baseInput })).toBeNull();
  });

  it("returns null for merged with empty task_id", () => {
    expect(
      computeTaskTransition({ ...baseInput, task_id: "" })
    ).toBeNull();
  });

  it("returns null for failed even with task_id", () => {
    expect(
      computeTaskTransition({
        ...baseInput,
        status: "failed",
        task_id: "task-do-thing"
      })
    ).toBeNull();
  });

  it("returns null for halted-conflict even with task_id", () => {
    expect(
      computeTaskTransition({
        ...baseInput,
        status: "halted-conflict",
        task_id: "task-do-thing"
      })
    ).toBeNull();
  });

  it("returns null for halted-red-ci even with task_id", () => {
    expect(
      computeTaskTransition({
        ...baseInput,
        status: "halted-red-ci",
        task_id: "task-do-thing"
      })
    ).toBeNull();
  });
});

describe("UnknownAgentError", () => {
  it("extends Error and has correct name", () => {
    const e = new UnknownAgentError("foo");
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(UnknownAgentError);
    expect(e.name).toBe("UnknownAgentError");
  });

  it("message includes the agent id", () => {
    const e = new UnknownAgentError("foo");
    expect(e.message).toContain("foo");
  });
});
