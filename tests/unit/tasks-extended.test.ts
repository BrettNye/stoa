import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTask, listTasks, updateTask } from "../../src/core/tasks.js";

describe("v1.5 — task lifecycle", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-tasks-v15-"));
    mkdirSync(join(vaultPath, "wikis", "alpha", "tasks"), { recursive: true });
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("createTask writes a pending task page", () => {
    const r = createTask(vaultPath, {
      title: "feat-x: API surface",
      wiki: "alpha",
      segregation: ["packages/api/**"],
      required_pokemon_type: "fire",
      channel: "feat-x-progress"
    });
    expect(r.id).toMatch(/^task-feat-x-api-surface/);
    expect(r.path).toContain(join("alpha", "tasks"));
  });

  it("listTasks returns all pending by default", () => {
    createTask(vaultPath, { title: "first task", wiki: "alpha" });
    createTask(vaultPath, { title: "second task", wiki: "alpha" });
    const list = listTasks(vaultPath, { wiki: "alpha" });
    expect(list).toHaveLength(2);
    expect(list.every(t => t.status === "pending")).toBe(true);
  });

  it("listTasks filters by status", () => {
    const a = createTask(vaultPath, { title: "task a", wiki: "alpha" });
    createTask(vaultPath, { title: "task b", wiki: "alpha" });
    const r = updateTask(vaultPath, {
      task_id: a.id, wiki: "alpha", status: "in_progress",
      expected_updated: a.updated, agent_id: "agent:tester"
    });
    const inProgress = listTasks(vaultPath, { wiki: "alpha", status: "in_progress" });
    expect(inProgress).toHaveLength(1);
    expect(inProgress[0].id).toBe(a.id);
  });

  it("listTasks filters by required_pokemon_type", () => {
    createTask(vaultPath, { title: "fire task", wiki: "alpha", required_pokemon_type: "fire" });
    createTask(vaultPath, { title: "water task", wiki: "alpha", required_pokemon_type: "water" });
    const fire = listTasks(vaultPath, { wiki: "alpha", pokemon_type: "fire" });
    expect(fire).toHaveLength(1);
    expect(fire[0].title).toBe("fire task");
  });

  it("updateTask refuses on stale expected_updated", () => {
    const a = createTask(vaultPath, { title: "task a", wiki: "alpha" });
    expect(() =>
      updateTask(vaultPath, {
        task_id: a.id, wiki: "alpha", status: "in_progress",
        expected_updated: "2020-01-01", agent_id: "agent:tester"
      })
    ).toThrow();
  });
});
