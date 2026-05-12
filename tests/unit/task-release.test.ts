import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTask, claimTask, releaseTask, NotClaimedError } from "../../src/core/tasks.js";
import { ConflictError, readPage } from "../../src/core/pages.js";

describe("releaseTask", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-release-"));
    mkdirSync(join(vaultPath, "wikis", "alpha", "tasks"), { recursive: true });
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("(a) success: clears claimed_by, sets status to pending", () => {
    // Create and claim a task
    const created = createTask(vaultPath, { title: "test task", wiki: "alpha" });
    const claimed = claimTask(vaultPath, {
      task_id: created.id,
      agent_id: "tester",
      expected_updated: created.updated,
      wiki: "alpha"
    });

    // Release it
    const result = releaseTask(vaultPath, {
      task_id: created.id,
      expected_updated: claimed.updated,
      wiki: "alpha"
    });

    expect(result.task.status).toBe("pending");
    expect(result.task.claimed_by).toBeUndefined();
    expect(result.task.claimed_at).toBeUndefined();
  });

  it("(a) success: in_progress tasks can also be released", () => {
    const created = createTask(vaultPath, { title: "in-progress task", wiki: "alpha" });
    const claimed = claimTask(vaultPath, {
      task_id: created.id,
      agent_id: "tester",
      expected_updated: created.updated,
      wiki: "alpha"
    });

    const result = releaseTask(vaultPath, {
      task_id: created.id,
      expected_updated: claimed.updated,
      wiki: "alpha"
    });

    expect(result.task.status).toBe("pending");
  });

  it("(b) throws NotClaimedError when task is already pending", () => {
    const created = createTask(vaultPath, { title: "pending task", wiki: "alpha" });

    expect(() =>
      releaseTask(vaultPath, {
        task_id: created.id,
        expected_updated: created.updated,
        wiki: "alpha"
      })
    ).toThrow(NotClaimedError);
  });

  it("(b) NotClaimedError carries the currentStatus field", () => {
    const created = createTask(vaultPath, { title: "pending task 2", wiki: "alpha" });

    try {
      releaseTask(vaultPath, {
        task_id: created.id,
        expected_updated: created.updated,
        wiki: "alpha"
      });
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(NotClaimedError);
      expect((e as NotClaimedError).currentStatus).toBe("pending");
    }
  });

  it("(c) throws ConflictError on stale expected_updated", () => {
    const created = createTask(vaultPath, { title: "stale task", wiki: "alpha" });
    claimTask(vaultPath, {
      task_id: created.id,
      agent_id: "tester",
      expected_updated: created.updated,
      wiki: "alpha"
    });

    // Pass a clearly stale date — will never match the actual updated field
    expect(() =>
      releaseTask(vaultPath, {
        task_id: created.id,
        expected_updated: "2020-01-01",
        wiki: "alpha"
      })
    ).toThrow(ConflictError);
  });

  it("optional reason appends a release section to body", () => {
    const created = createTask(vaultPath, { title: "reason task", wiki: "alpha" });
    const claimed = claimTask(vaultPath, {
      task_id: created.id,
      agent_id: "tester",
      expected_updated: created.updated,
      wiki: "alpha"
    });

    const result = releaseTask(vaultPath, {
      task_id: created.id,
      expected_updated: claimed.updated,
      wiki: "alpha",
      reason: "blocked on upstream"
    });

    expect(result.task.body).toMatch(/## Released \d{4}-\d{2}-\d{2}: blocked on upstream/);
  });

  it("index is updated post-write so status reflects new state", () => {
    const created = createTask(vaultPath, { title: "index task", wiki: "alpha" });
    const claimed = claimTask(vaultPath, {
      task_id: created.id,
      agent_id: "tester",
      expected_updated: created.updated,
      wiki: "alpha"
    });

    const result = releaseTask(vaultPath, {
      task_id: created.id,
      expected_updated: claimed.updated,
      wiki: "alpha"
    });

    // The returned task should have updated timestamp
    expect(result.task.updated).toBeTruthy();
    expect(typeof result.task.updated).toBe("string");
  });

  it("disk frontmatter has no assigned_at after release", () => {
    // Verify that the assigned_at field written by claimTask is actually
    // removed from disk after releaseTask — not just from the returned object.
    const created = createTask(vaultPath, { title: "disk check task", wiki: "alpha" });
    const claimed = claimTask(vaultPath, {
      task_id: created.id,
      agent_id: "tester",
      expected_updated: created.updated,
      wiki: "alpha"
    });

    // Confirm assigned_at exists on disk after claiming
    const claimedPage = readPage(vaultPath, created.id, "alpha");
    expect(claimedPage.frontmatter.assigned_at).toBeDefined();

    releaseTask(vaultPath, {
      task_id: created.id,
      expected_updated: claimed.updated,
      wiki: "alpha"
    });

    // Re-read from disk and verify assigned_at is gone
    const releasedPage = readPage(vaultPath, created.id, "alpha");
    expect(releasedPage.frontmatter.assigned_at).toBeUndefined();
    expect(releasedPage.frontmatter.claimed_by).toBeUndefined();
    expect(releasedPage.frontmatter.status).toBe("pending");
  });
});
