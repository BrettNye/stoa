import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { taskUpdateTool } from "../../src/tools/task-update.js";
import { createTask } from "../../src/core/tasks.js";

describe("vault.task-update", () => {
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
    const r = await taskUpdateTool.handler({
      task_id: a.id,
      wiki: "alpha",
      expected_updated: a.updated,
      status: "in_progress",
      agent_id: "agent:tester"
    }, { vaultPath });
    expect(r.status).toBe("in_progress");
  });

  it("appends notes", async () => {
    const a = createTask(vaultPath, { title: "task a", wiki: "alpha" });
    await taskUpdateTool.handler({
      task_id: a.id,
      wiki: "alpha",
      expected_updated: a.updated,
      notes: "started work; tests at /api/v1",
      agent_id: "agent:tester"
    }, { vaultPath });
    // (Body assertion is in core/tasks.test.ts; here we just verify no throw.)
  });
});
