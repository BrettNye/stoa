import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimTask, createTask, AlreadyClaimedError } from "./tasks.js";

describe("claimTask concurrency", () => {
  let vault: string;

  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), "stoa-claim-"));
    mkdirSync(join(vault, "wikis", "alpha", "tasks"), { recursive: true });
    mkdirSync(join(vault, "_index", ".locks"), { recursive: true });
  });

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
  });

  it("two concurrent same-day claimants — exactly one succeeds", async () => {
    const { id: taskId, updated } = createTask(vault, {
      title: "test concurrent claim",
      wiki: "alpha",
      description: [
        "## Scope",
        "Test the lock.",
        "",
        "## Out of scope",
        "Unrelated cleanup.",
        "",
        "## Verification",
        "- [ ] x",
        "",
        "Touches `src/core/tasks.ts`.",
      ].join("\n"),
    });

    const settled = await Promise.allSettled([
      claimTask(vault, { task_id: taskId, agent_id: "alice", expected_updated: updated, wiki: "alpha" }),
      claimTask(vault, { task_id: taskId, agent_id: "bob", expected_updated: updated, wiki: "alpha" }),
    ]);

    const fulfilled = settled.filter((r) => r.status === "fulfilled");
    const rejected = settled.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    const rejectionReason = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejectionReason).toBeInstanceOf(AlreadyClaimedError);
  });

  it("claimTask returns a Promise", async () => {
    const { id: taskId, updated } = createTask(vault, {
      title: "test promise return",
      wiki: "alpha",
      description: [
        "## Scope",
        "Test async.",
        "",
        "## Out of scope",
        "Nothing.",
        "",
        "## Verification",
        "- [ ] passes",
        "",
        "Touches `src/core/tasks.ts`.",
      ].join("\n"),
    });

    const result = claimTask(vault, { task_id: taskId, agent_id: "charlie", expected_updated: updated, wiki: "alpha" });
    expect(result).toBeInstanceOf(Promise);
    const resolved = await result;
    expect(resolved.task_id).toBe(taskId);
    expect(resolved.claimed_by).toBe("agent:charlie");
  });
});
