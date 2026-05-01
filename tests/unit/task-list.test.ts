import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { taskListTool } from "../../src/tools/task-list.js";
import { createTask } from "../../src/core/tasks.js";
import { recordRename } from "../../src/core/aliases.js";

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

  describe("alias-aware claimed_by filter", () => {
    function setClaimedBy(vault: string, wiki: string, taskId: string, claimedBy: string) {
      const path = join(vault, "wikis", wiki, "tasks", `${taskId}.md`);
      const raw = readFileSync(path, "utf8");
      const updated = raw.replace(/^(---\n[\s\S]*?\n)(---)/, (_m, fmBlock, end) => {
        return fmBlock + `claimed_by: ${claimedBy}\n` + end;
      });
      writeFileSync(path, updated);
    }

    it("returns tasks claimed under historical agent ids", async () => {
      // Two tasks claimed under the historical id agent:charmander
      const t1 = createTask(vaultPath, { title: "old task one", wiki: "alpha" });
      const t2 = createTask(vaultPath, { title: "old task two", wiki: "alpha" });
      setClaimedBy(vaultPath, "alpha", t1.id, "agent:charmander");
      setClaimedBy(vaultPath, "alpha", t2.id, "agent:charmander");

      // Control: a task claimed by an unrelated agent
      const t3 = createTask(vaultPath, { title: "unrelated", wiki: "alpha" });
      setClaimedBy(vaultPath, "alpha", t3.id, "agent:pikachu");

      // Record charmander → charmeleon evolution (profile rename)
      recordRename(vaultPath, "profile-charmander", "profile-charmeleon");

      // Query for the CURRENT id charmeleon — should surface both historical tasks
      const r = await taskListTool.handler(
        { claimed_by: "agent:charmeleon" },
        { vaultPath }
      );
      const titles = r.tasks.map(t => t.title).sort();
      expect(titles).toEqual(["old task one", "old task two"]);
    });

    it("does not surface unrelated agent's tasks", async () => {
      const t = createTask(vaultPath, { title: "pika task", wiki: "alpha" });
      setClaimedBy(vaultPath, "alpha", t.id, "agent:pikachu");

      recordRename(vaultPath, "profile-charmander", "profile-charmeleon");

      const r = await taskListTool.handler(
        { claimed_by: "agent:charmeleon" },
        { vaultPath }
      );
      expect(r.tasks).toHaveLength(0);
    });

    it("walks transitive alias chains (charmander → charmeleon → charizard)", async () => {
      const t1 = createTask(vaultPath, { title: "earliest", wiki: "alpha" });
      const t2 = createTask(vaultPath, { title: "middle", wiki: "alpha" });
      const t3 = createTask(vaultPath, { title: "current", wiki: "alpha" });
      setClaimedBy(vaultPath, "alpha", t1.id, "agent:charmander");
      setClaimedBy(vaultPath, "alpha", t2.id, "agent:charmeleon");
      setClaimedBy(vaultPath, "alpha", t3.id, "agent:charizard");

      recordRename(vaultPath, "profile-charmander", "profile-charmeleon");
      recordRename(vaultPath, "profile-charmeleon", "profile-charizard");

      const r = await taskListTool.handler(
        { claimed_by: "agent:charizard" },
        { vaultPath }
      );
      const titles = r.tasks.map(t => t.title).sort();
      expect(titles).toEqual(["current", "earliest", "middle"]);
    });
  });
});
