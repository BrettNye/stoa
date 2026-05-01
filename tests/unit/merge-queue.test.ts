import { describe, it, expect } from "vitest";
import {
  parseReadySignals,
  mapReadyToTasks,
  topoSortReady,
  buildMergeQueue,
  type ReadyEntry,
  type TaskRef,
} from "../../src/core/merge-queue.js";

// ---------- parseReadySignals ----------

describe("parseReadySignals", () => {
  it("matches body containing both 'ready: branch=feat/foo' and 'PR-42'", () => {
    const out = parseReadySignals([
      {
        journal_id: "j1",
        body: "Hey team, ready: branch=feat/foo PR-42",
        posted_at: "2026-04-30T10:00:00Z",
        author: "agent:a",
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      journal_id: "j1",
      branch: "feat/foo",
      pr_number: 42,
      posted_at: "2026-04-30T10:00:00Z",
      author: "agent:a",
    });
  });

  it("matches body containing 'ready feat/bar' and '#7'", () => {
    const out = parseReadySignals([
      {
        journal_id: "j2",
        body: "ready feat/bar #7 lgtm",
        posted_at: "2026-04-30T11:00:00Z",
        author: "agent:b",
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].branch).toBe("feat/bar");
    expect(out[0].pr_number).toBe(7);
  });

  it("does NOT match a body that only has a ready signal but no PR number", () => {
    const out = parseReadySignals([
      {
        journal_id: "j3",
        body: "ready: feat/foo (no PR yet)",
        posted_at: "2026-04-30T11:00:00Z",
        author: "agent:b",
      },
    ]);
    expect(out).toHaveLength(0);
  });

  it("does NOT match a body that only has a PR number but no ready signal", () => {
    const out = parseReadySignals([
      {
        journal_id: "j4",
        body: "see PR-42 for details",
        posted_at: "2026-04-30T11:00:00Z",
        author: "agent:b",
      },
    ]);
    expect(out).toHaveLength(0);
  });

  it("returns multiple entries when multiple bodies qualify", () => {
    const out = parseReadySignals([
      {
        journal_id: "j1",
        body: "ready: feat/a PR-1",
        posted_at: "2026-04-30T10:00:00Z",
        author: "agent:a",
      },
      {
        journal_id: "j2",
        body: "ready feat/b #2",
        posted_at: "2026-04-30T10:01:00Z",
        author: "agent:b",
      },
      {
        journal_id: "j3",
        body: "no signal here",
        posted_at: "2026-04-30T10:02:00Z",
        author: "agent:c",
      },
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.pr_number)).toEqual([1, 2]);
  });

  it("strips a leading 'branch=' prefix from the captured group", () => {
    const out = parseReadySignals([
      {
        journal_id: "j1",
        body: "ready: branch=feat/foo PR-9",
        posted_at: "2026-04-30T10:00:00Z",
        author: "agent:a",
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].branch).toBe("feat/foo");
  });
});

// ---------- mapReadyToTasks ----------

describe("mapReadyToTasks", () => {
  const channel = "feat-foo-progress";

  it("matches a ready entry whose branch ends with task.branch_suffix in the same channel", () => {
    const ready: ReadyEntry[] = [
      {
        journal_id: "j1",
        branch: "feat/api/charmander",
        pr_number: 10,
        posted_at: "2026-04-30T10:00:00Z",
        author: "agent:a",
      },
    ];
    const tasks: TaskRef[] = [
      {
        id: "task-charmander",
        channel,
        blocking: [],
        branch_suffix: "charmander",
        status: "claimed",
      },
    ];
    const r = mapReadyToTasks(ready, tasks, channel);
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].task?.id).toBe("task-charmander");
    expect(r.warnings).toEqual([]);
  });

  it("returns task: null and a warning when no task matches", () => {
    const ready: ReadyEntry[] = [
      {
        journal_id: "j1",
        branch: "feat/orphan",
        pr_number: 99,
        posted_at: "2026-04-30T10:00:00Z",
        author: "agent:a",
      },
    ];
    const tasks: TaskRef[] = [];
    const r = mapReadyToTasks(ready, tasks, channel);
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].task).toBeNull();
    expect(r.warnings.some((w) => w.includes("PR #99 has no matching task"))).toBe(true);
  });

  it("first task wins when multiple tasks match; warning emitted", () => {
    const ready: ReadyEntry[] = [
      {
        journal_id: "j1",
        branch: "feat/api/foo",
        pr_number: 5,
        posted_at: "2026-04-30T10:00:00Z",
        author: "agent:a",
      },
    ];
    const tasks: TaskRef[] = [
      { id: "task-A", channel, blocking: [], branch_suffix: "foo", status: "claimed" },
      { id: "task-B", channel, blocking: [], branch_suffix: "foo", status: "claimed" },
    ];
    const r = mapReadyToTasks(ready, tasks, channel);
    expect(r.matched[0].task?.id).toBe("task-A");
    expect(r.warnings.some((w) => w.includes("matched multiple tasks"))).toBe(true);
  });

  it("ignores tasks in a different channel", () => {
    const ready: ReadyEntry[] = [
      {
        journal_id: "j1",
        branch: "feat/api/foo",
        pr_number: 5,
        posted_at: "2026-04-30T10:00:00Z",
        author: "agent:a",
      },
    ];
    const tasks: TaskRef[] = [
      {
        id: "task-A",
        channel: "feat-other-progress",
        blocking: [],
        branch_suffix: "foo",
        status: "claimed",
      },
    ];
    const r = mapReadyToTasks(ready, tasks, channel);
    expect(r.matched[0].task).toBeNull();
  });
});

// ---------- topoSortReady ----------

describe("topoSortReady", () => {
  const channel = "feat-foo-progress";

  function ready(
    pr: number,
    posted_at: string,
    journal_id = `j${pr}`,
    branch = `feat/${pr}`,
  ): ReadyEntry {
    return { journal_id, branch, pr_number: pr, posted_at, author: "agent:x" };
  }
  function task(id: string, blocking: string[] = []): TaskRef {
    return { id, channel, blocking, branch_suffix: id, status: "claimed" };
  }

  it("linear chain A->B->C produces dependency_order [A,B,C]", () => {
    const matched = [
      { ready: ready(1, "2026-04-30T10:00:00Z"), task: task("A") },
      { ready: ready(2, "2026-04-30T10:01:00Z"), task: task("B", ["A"]) },
      { ready: ready(3, "2026-04-30T10:02:00Z"), task: task("C", ["B"]) },
    ];
    const r = topoSortReady(matched);
    expect(r.dependency_order).toEqual([1, 2, 3]);
    expect(r.warnings).toEqual([]);
  });

  it("diamond: A blocks B+C, both block D — A first, D last, B/C tie-broken by posted_at then pr_number", () => {
    const matched = [
      { ready: ready(1, "2026-04-30T10:00:00Z"), task: task("A") },
      { ready: ready(3, "2026-04-30T10:02:00Z"), task: task("B", ["A"]) },
      { ready: ready(2, "2026-04-30T10:01:00Z"), task: task("C", ["A"]) },
      { ready: ready(4, "2026-04-30T10:03:00Z"), task: task("D", ["B", "C"]) },
    ];
    const r = topoSortReady(matched);
    // A first (only zero-degree node); after A: B and C both 0. tie-break: C posted earlier (10:01) than B (10:02).
    expect(r.dependency_order[0]).toBe(1);
    expect(r.dependency_order[r.dependency_order.length - 1]).toBe(4);
    expect(r.dependency_order).toEqual([1, 2, 3, 4]);
  });

  it("cycle: A.blocking=[B], B.blocking=[A] — warning emitted, both appended last in pr_number order", () => {
    const matched = [
      { ready: ready(1, "2026-04-30T10:00:00Z"), task: task("A", ["B"]) },
      { ready: ready(2, "2026-04-30T10:01:00Z"), task: task("B", ["A"]) },
    ];
    const r = topoSortReady(matched);
    expect(r.warnings.some((w) => w.includes("cycle detected"))).toBe(true);
    expect(r.dependency_order).toEqual([1, 2]);
  });

  it("orphan PR (task: null) participates in tie-break", () => {
    const matched = [
      { ready: ready(2, "2026-04-30T10:01:00Z"), task: task("A") },
      { ready: ready(7, "2026-04-30T10:00:00Z"), task: null },
    ];
    const r = topoSortReady(matched);
    // PR-7 posted earlier → first
    expect(r.dependency_order).toEqual([7, 2]);
  });

  it("tie-break by timestamp: earlier posted_at wins", () => {
    const matched = [
      { ready: ready(5, "2026-04-30T10:01:00Z"), task: task("A") },
      { ready: ready(3, "2026-04-30T10:00:00Z"), task: task("B") },
    ];
    const r = topoSortReady(matched);
    expect(r.dependency_order).toEqual([3, 5]);
  });

  it("tie-break by pr_number when posted_at identical: smaller pr_number wins", () => {
    const matched = [
      { ready: ready(9, "2026-04-30T10:00:00Z"), task: task("A") },
      { ready: ready(3, "2026-04-30T10:00:00Z"), task: task("B") },
    ];
    const r = topoSortReady(matched);
    expect(r.dependency_order).toEqual([3, 9]);
  });
});

// ---------- buildMergeQueue (end-to-end) ----------

describe("buildMergeQueue", () => {
  it("end-to-end: 3 ready entries + linear blocking + 1 unready task", () => {
    const channel = "feat-foo-progress";
    const channelEntries = [
      {
        journal_id: "j1",
        body: "ready: branch=feat/api/A PR-1",
        posted_at: "2026-04-30T10:00:00Z",
        author: "agent:a",
      },
      {
        journal_id: "j2",
        body: "ready: branch=feat/api/B PR-2",
        posted_at: "2026-04-30T10:01:00Z",
        author: "agent:b",
      },
      {
        journal_id: "j3",
        body: "ready: branch=feat/api/C PR-3",
        posted_at: "2026-04-30T10:02:00Z",
        author: "agent:c",
      },
    ];
    const tasks: TaskRef[] = [
      {
        id: "task-A",
        channel,
        blocking: [],
        branch_suffix: "A",
        status: "claimed",
        claimed_by: "agent:a",
      },
      {
        id: "task-B",
        channel,
        blocking: ["task-A"],
        branch_suffix: "B",
        status: "claimed",
        claimed_by: "agent:b",
      },
      {
        id: "task-C",
        channel,
        blocking: ["task-B"],
        branch_suffix: "C",
        status: "claimed",
        claimed_by: "agent:c",
      },
      {
        id: "task-D",
        channel,
        blocking: [],
        branch_suffix: "D",
        status: "claimed",
        claimed_by: "agent:d",
      },
    ];
    const out = buildMergeQueue(channelEntries, tasks, channel);
    expect(out.feature).toBe("foo");
    expect(out.ready_prs).toHaveLength(3);
    expect(out.ready_prs.every((p) => p.ci_status === "unknown")).toBe(true);
    expect(out.dependency_order).toEqual([1, 2, 3]);
    expect(out.unready_prs).toHaveLength(1);
    expect(out.unready_prs[0]).toEqual({
      task_id: "task-D",
      claimed_by: "agent:d",
      branch_inferred: "D",
    });
    expect(out.warnings).toEqual([]);
  });

  it("unmappable ready entry yields task_id: null, blocking: [], and a warning", () => {
    const channel = "feat-foo-progress";
    const channelEntries = [
      {
        journal_id: "j1",
        body: "ready: branch=feat/orphan PR-99",
        posted_at: "2026-04-30T10:00:00Z",
        author: "agent:x",
      },
    ];
    const tasks: TaskRef[] = [];
    const out = buildMergeQueue(channelEntries, tasks, channel);
    expect(out.ready_prs).toHaveLength(1);
    expect(out.ready_prs[0].task_id).toBeNull();
    expect(out.ready_prs[0].blocking).toEqual([]);
    expect(out.warnings.some((w) => w.includes("PR #99 has no matching task"))).toBe(true);
  });

  it("non-feat channel name is used verbatim as feature", () => {
    const out = buildMergeQueue([], [], "random-channel");
    expect(out.feature).toBe("random-channel");
    expect(out.ready_prs).toEqual([]);
    expect(out.unready_prs).toEqual([]);
    expect(out.dependency_order).toEqual([]);
  });
});
