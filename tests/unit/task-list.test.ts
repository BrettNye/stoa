import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { taskListTool } from "../../src/tools/task-list.js";
import { createTask } from "../../src/core/tasks.js";

describe("vault.task-list", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-tl-"));
    mkdirSync(join(vaultPath, "wikis", "alpha", "tasks"), { recursive: true });
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("returns tasks filtered by wiki", async () => {
    createTask(vaultPath, { title: "task one", wiki: "alpha" });
    const r = await taskListTool.handler({ wiki: "alpha" }, { vaultPath });
    expect(r.tasks).toHaveLength(1);
    expect(r.tasks[0].title).toBe("task one");
  });
});
