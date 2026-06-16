import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimTask, AlreadyClaimedError } from "../../src/core/tasks.js";
import { ConflictError } from "../../src/core/pages.js";
import { taskTool } from "../../src/tools/task.js";
import { reindex } from "../../src/core/reindex.js";

let vault: string;

const GROOMED_BODY = `Touches \`src/foo.ts:1\`.

**Scope:** stub.

**Out of scope:** nothing.

**Acceptance criteria:** test passes.
`;

function writeTask(claimedBy?: string, taskId = "task-foo") {
  const fm: any = {
    id: taskId, title: "Foo", type: "task", wiki: "alpha",
    status: claimedBy ? "claimed" : "pending",
    created: "2026-04-28", updated: "2026-04-28"
  };
  if (claimedBy) fm.claimed_by = claimedBy;
  writeFileSync(
    join(vault, "wikis", "alpha", "tasks", `${taskId}.md`),
    `---\n${Object.entries(fm).map(([k,v]) => `${k}: ${typeof v === "string" ? `"${v}"` : v}`).join("\n")}\n---\n${GROOMED_BODY}`
  );
}

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-task-"));
  mkdirSync(join(vault, "wikis", "alpha", "tasks"), { recursive: true });
  mkdirSync(join(vault, "_index"), { recursive: true });
  writeFileSync(join(vault, "_index", "aliases.json"), "{}");
});

describe("claimTask (core)", () => {
  it("claims an unclaimed task", async () => {
    writeTask();
    const result = await claimTask(vault, { task_id: "task-foo", agent_id: "claude-code", expected_updated: "2026-04-28" });
    expect(result.claimed_by).toBe("agent:claude-code");
    expect(result.task_id).toBe("task-foo");
  });

  it("idempotent re-claim by same agent", async () => {
    writeTask("agent:claude-code");
    const result = await claimTask(vault, { task_id: "task-foo", agent_id: "claude-code", expected_updated: "2026-04-28" });
    expect(result.claimed_by).toBe("agent:claude-code");
  });

  it("rejects claim by other agent", async () => {
    writeTask("agent:other");
    await expect(claimTask(vault, { task_id: "task-foo", agent_id: "claude-code", expected_updated: "2026-04-28" }))
      .rejects.toThrow(AlreadyClaimedError);
  });

  it("throws ConflictError on stale expected_updated", async () => {
    writeTask();
    await expect(claimTask(vault, { task_id: "task-foo", agent_id: "claude-code", expected_updated: "1999-01-01" }))
      .rejects.toThrow(ConflictError);
  });
});

// ── taskTool consolidated tests ──────────────────────────────────────────────

describe("taskTool scope.axis", () => {
  it("returns wikis/* for mode=create with no wiki", () => {
    const axis = (taskTool.scope as any).axis({ mode: "create" });
    expect(axis).toBe("wikis/*");
  });

  it("returns wikis/alpha for mode=create with wiki=alpha", () => {
    const axis = (taskTool.scope as any).axis({ mode: "create", wiki: "alpha" });
    expect(axis).toBe("wikis/alpha");
  });

  it("returns wikis/* for mode=list with no wiki", () => {
    const axis = (taskTool.scope as any).axis({ mode: "list" });
    expect(axis).toBe("wikis/*");
  });

  it("returns wikis/alpha for mode=list with wiki=alpha", () => {
    const axis = (taskTool.scope as any).axis({ mode: "list", wiki: "alpha" });
    expect(axis).toBe("wikis/alpha");
  });

  it("returns tasks/task-foo for mode=update with task_id=task-foo", () => {
    const axis = (taskTool.scope as any).axis({ mode: "update", task_id: "task-foo" });
    expect(axis).toBe("tasks/task-foo");
  });

  it("returns tasks/* for mode=update with no task_id", () => {
    const axis = (taskTool.scope as any).axis({ mode: "update" });
    expect(axis).toBe("tasks/*");
  });

  it("returns tasks/task-foo for mode=claim with task_id=task-foo", () => {
    const axis = (taskTool.scope as any).axis({ mode: "claim", task_id: "task-foo" });
    expect(axis).toBe("tasks/task-foo");
  });
});

describe("taskTool mode=create", () => {
  beforeEach(async () => {
    await reindex(vault);
  });

  it("creates a task and returns id/path/updated", async () => {
    const result = await taskTool.handler(
      { mode: "create", title: "My new task", wiki: "alpha", limit: 50 },
      { vaultPath: vault }
    );
    expect(result.id).toMatch(/^task-/);
    expect(result.path).toBeDefined();
    expect(result.updated).toBeDefined();
  });

  it("requires title field", async () => {
    await expect(
      taskTool.handler(
        { mode: "create", wiki: "alpha", limit: 50 },
        { vaultPath: vault }
      )
    ).rejects.toThrow("title");
  });

  it("requires wiki field", async () => {
    await expect(
      taskTool.handler(
        { mode: "create", title: "A task", limit: 50 },
        { vaultPath: vault }
      )
    ).rejects.toThrow("wiki");
  });
});

describe("taskTool mode=list", () => {
  it("lists tasks in a wiki", async () => {
    writeTask();
    const result = await taskTool.handler(
      { mode: "list", wiki: "alpha", limit: 50 },
      { vaultPath: vault }
    );
    expect(result.tasks).toBeDefined();
    expect(result.tasks.length).toBeGreaterThan(0);
    expect(result.tasks[0].id).toBe("task-foo");
  });

  it("filters by status", async () => {
    writeTask();
    const pendingResult = await taskTool.handler(
      { mode: "list", wiki: "alpha", status: "pending", limit: 50 },
      { vaultPath: vault }
    );
    expect(pendingResult.tasks.length).toBe(1);

    const claimedResult = await taskTool.handler(
      { mode: "list", wiki: "alpha", status: "claimed", limit: 50 },
      { vaultPath: vault }
    );
    expect(claimedResult.tasks.length).toBe(0);
  });

  it("alias-aware claimed_by expansion", async () => {
    writeTask("agent:claude-code");
    const result = await taskTool.handler(
      { mode: "list", wiki: "alpha", claimed_by: "agent:claude-code", limit: 50 },
      { vaultPath: vault }
    );
    expect(result.tasks.length).toBe(1);
    expect(result.tasks[0].claimed_by).toBe("agent:claude-code");
  });
});

describe("taskTool mode=update", () => {
  it("updates a task status, agent_id from principal", async () => {
    writeTask();
    const result = await taskTool.handler(
      {
        mode: "update",
        task_id: "task-foo",
        wiki: "alpha",
        expected_updated: "2026-04-28",
        status: "in_progress",
        limit: 50
      },
      { vaultPath: vault, principal: { agent_id: "charmander" } }
    );
    expect(result.task_id).toBe("task-foo");
    expect(result.status).toBe("in_progress");
  });

  it("requires task_id", async () => {
    await expect(
      taskTool.handler(
        { mode: "update", wiki: "alpha", expected_updated: "2026-04-28", limit: 50 },
        { vaultPath: vault }
      )
    ).rejects.toThrow("task_id");
  });

  it("requires wiki", async () => {
    await expect(
      taskTool.handler(
        { mode: "update", task_id: "task-foo", expected_updated: "2026-04-28", limit: 50 },
        { vaultPath: vault }
      )
    ).rejects.toThrow("wiki");
  });

  it("requires expected_updated", async () => {
    await expect(
      taskTool.handler(
        { mode: "update", task_id: "task-foo", wiki: "alpha", limit: 50 },
        { vaultPath: vault }
      )
    ).rejects.toThrow("expected_updated");
  });

  it("uses stoa-local as fallback agent_id when no principal", async () => {
    writeTask();
    const result = await taskTool.handler(
      {
        mode: "update",
        task_id: "task-foo",
        wiki: "alpha",
        expected_updated: "2026-04-28",
        notes: "Some note",
        limit: 50
      },
      { vaultPath: vault }
    );
    // Should succeed without principal
    expect(result.task_id).toBe("task-foo");
  });
});

describe("taskTool mode=claim", () => {
  it("claims a pending task using agent_id from principal", async () => {
    writeTask();
    const result = await taskTool.handler(
      {
        mode: "claim",
        task_id: "task-foo",
        expected_updated: "2026-04-28",
        wiki: "alpha",
        limit: 50
      },
      { vaultPath: vault, principal: { agent_id: "charmander" } }
    );
    expect(result.claimed_by).toBe("agent:charmander");
    expect(result.task_id).toBe("task-foo");
  });

  it("requires task_id", async () => {
    await expect(
      taskTool.handler(
        { mode: "claim", expected_updated: "2026-04-28", limit: 50 },
        { vaultPath: vault, principal: { agent_id: "charmander" } }
      )
    ).rejects.toThrow("task_id");
  });

  it("requires expected_updated", async () => {
    await expect(
      taskTool.handler(
        { mode: "claim", task_id: "task-foo", limit: 50 },
        { vaultPath: vault, principal: { agent_id: "charmander" } }
      )
    ).rejects.toThrow("expected_updated");
  });

  it("maps TaskNotReadyError to TASK_NOT_READY code", async () => {
    // Write a task that is not groomed (no Scope / Out of scope / Acceptance criteria)
    const fm: any = {
      id: "task-ungroomed", title: "Ungroomed", type: "task", wiki: "alpha",
      status: "pending", created: "2026-04-28", updated: "2026-04-28"
    };
    writeFileSync(
      join(vault, "wikis", "alpha", "tasks", "task-ungroomed.md"),
      `---\n${Object.entries(fm).map(([k,v]) => `${k}: "${v}"`).join("\n")}\n---\nJust a description, no grooming signals.\n`
    );
    try {
      await taskTool.handler(
        {
          mode: "claim",
          task_id: "task-ungroomed",
          expected_updated: "2026-04-28",
          wiki: "alpha",
          limit: 50
        },
        { vaultPath: vault, principal: { agent_id: "charmander" } }
      );
      expect.fail("should have thrown");
    } catch (e: any) {
      expect(e.code).toBe("TASK_NOT_READY");
      expect(e.missing).toBeDefined();
    }
  });
});
