import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { taskTool } from "../../src/tools/task.js";
import { createTask } from "../../src/core/tasks.js";

describe("vault_task-update", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-tu-"));
    mkdirSync(join(vaultPath, "wikis", "alpha", "tasks"), { recursive: true });
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("updates status with matching expected_updated", async () => {
    const a = createTask(vaultPath, { title: "task a", wiki: "alpha" });
    const r = await taskTool.handler({
      mode: "update",
      task_id: a.id,
      wiki: "alpha",
      expected_updated: a.updated,
      status: "in_progress",
    }, { vaultPath, principal: { agent_id: "agent:tester" } });
    expect(r.status).toBe("in_progress");
  });

  it("appends notes", async () => {
    const a = createTask(vaultPath, { title: "task a", wiki: "alpha" });
    await taskTool.handler({
      mode: "update",
      task_id: a.id,
      wiki: "alpha",
      expected_updated: a.updated,
      notes: "started work; tests at /api/v1",
    }, { vaultPath, principal: { agent_id: "agent:tester" } });
    // (Body assertion is in core/tasks.test.ts; here we just verify no throw.)
  });
});
