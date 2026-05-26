import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { claimTask, TaskNotReadyError } from "../../src/core/tasks.js";
import type { TaskReadinessSignal } from "../../src/core/task-readiness.js";

// A body that passes all four readiness signals
const GROOMED_BODY = `# Task: do the thing

## Scope
Implement the feature in src/core/foo.ts.

## Out of scope
No refactoring of unrelated code.

## Verification
- src/core/foo.ts exports FooResult
- tests pass
`;

// A one-liner body that fails all four signals
const UNGROOMED_BODY = "one-line body";

function writeTaskPage(
  vaultPath: string,
  id: string,
  body: string,
  extra: Record<string, unknown> = {}
): string {
  const updated = new Date().toISOString().slice(0, 10);
  const fm = [
    "---",
    `id: ${id}`,
    `title: Test task`,
    `type: task`,
    `wiki: alpha`,
    `status: pending`,
    `created: ${updated}`,
    `updated: ${updated}`,
    `summary: Test task`,
    ...Object.entries(extra).map(([k, v]) => `${k}: ${String(v)}`),
    "---",
  ].join("\n");
  const content = `${fm}\n${body}`;
  const tasksDir = join(vaultPath, "wikis", "alpha", "tasks");
  writeFileSync(join(tasksDir, `${id}.md`), content, "utf8");
  return updated;
}

describe("claimTask — readiness gate", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-readiness-"));
    mkdirSync(join(vaultPath, "wikis", "alpha", "tasks"), { recursive: true });
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("throws TaskNotReadyError when body is ungroomed (missing all signals)", async () => {
    const id = "task-ungroomed";
    const expected_updated = writeTaskPage(vaultPath, id, UNGROOMED_BODY);
    await expect(
      claimTask(vaultPath, {
        task_id: id,
        agent_id: "charmander",
        expected_updated,
        wiki: "alpha",
      })
    ).rejects.toThrow(TaskNotReadyError);
  });

  it("TaskNotReadyError carries the correct missing signals", async () => {
    const id = "task-ungroomed-signals";
    const expected_updated = writeTaskPage(vaultPath, id, UNGROOMED_BODY);
    let thrown: TaskNotReadyError | undefined;
    try {
      await claimTask(vaultPath, {
        task_id: id,
        agent_id: "charmander",
        expected_updated,
        wiki: "alpha",
      });
    } catch (e) {
      if (e instanceof TaskNotReadyError) thrown = e;
    }
    expect(thrown).toBeDefined();
    expect(thrown!.name).toBe("TaskNotReadyError");
    const expected: TaskReadinessSignal[] = ["files", "scope", "out_of_scope", "verification"];
    expect(thrown!.missing).toEqual(expected);
    expect(thrown!.taskId).toBe(id);
    expect(thrown!.message).toMatch(/TASK_NOT_READY/);
  });

  it("succeeds when body is groomed (all signals present)", async () => {
    const id = "task-groomed";
    const expected_updated = writeTaskPage(vaultPath, id, GROOMED_BODY);
    const result = await claimTask(vaultPath, {
      task_id: id,
      agent_id: "charmander",
      expected_updated,
      wiki: "alpha",
    });
    expect(result.claimed_by).toBe("agent:charmander");
    expect(result.task_id).toBe(id);
  });

  it("force: true bypasses the readiness check on an ungroomed body", async () => {
    const id = "task-force-bypass";
    const expected_updated = writeTaskPage(vaultPath, id, UNGROOMED_BODY);
    const result = await claimTask(vaultPath, {
      task_id: id,
      agent_id: "charmander",
      expected_updated,
      wiki: "alpha",
      force: true,
    });
    expect(result.claimed_by).toBe("agent:charmander");
    expect(result.task_id).toBe(id);
  });

  it("readiness gate fires AFTER type check — WrongTypeError takes priority when type is wrong", async () => {
    // If both required_pokemon_type mismatch AND body is ungroomed,
    // WrongTypeError fires first (type-gate is cheaper, runs before readiness)
    const profilesDir = join(vaultPath, "wikis", "_agents", "profiles");
    mkdirSync(profilesDir, { recursive: true });
    writeFileSync(
      join(profilesDir, "profile-squirtle.md"),
      `---
id: profile-squirtle
title: Squirtle
type: profile
wiki: _agents
status: active
created: 2026-04-29
updated: 2026-04-29
summary: Frontend
pokemon_type: water
evolution_stage: basic
autonomy_level: restricted
moveset: []
applies_to: [claude-code]
---
`
    );
    const id = "task-type-and-readiness";
    const expected_updated = writeTaskPage(vaultPath, id, UNGROOMED_BODY, {
      required_pokemon_type: "fire",
    });
    // squirtle is water-type, task requires fire, body is also ungroomed
    // WrongTypeError should be thrown (type check fires before readiness)
    await expect(
      claimTask(vaultPath, {
        task_id: id,
        agent_id: "squirtle",
        expected_updated,
        wiki: "alpha",
      })
    ).rejects.toThrow(/WRONG_TYPE/);
  });

  it("readiness gate fires BEFORE AlreadyClaimedError — TaskNotReadyError on ungroomed already-claimed task", async () => {
    // Body is ungroomed AND task is already claimed by someone else.
    // Readiness gate should fire before AlreadyClaimedError.
    const id = "task-claimed-and-ungroomed";
    const updated = new Date().toISOString().slice(0, 10);
    const fm = [
      "---",
      `id: ${id}`,
      `title: Test task`,
      `type: task`,
      `wiki: alpha`,
      `status: claimed`,
      `created: ${updated}`,
      `updated: ${updated}`,
      `summary: Test task`,
      `claimed_by: agent:wartortle`,
      "---",
    ].join("\n");
    const content = `${fm}\n${UNGROOMED_BODY}`;
    const tasksDir = join(vaultPath, "wikis", "alpha", "tasks");
    writeFileSync(join(tasksDir, `${id}.md`), content, "utf8");
    // charmander tries to claim it — body is ungroomed AND already claimed by wartortle
    await expect(
      claimTask(vaultPath, {
        task_id: id,
        agent_id: "charmander",
        expected_updated: updated,
        wiki: "alpha",
      })
    ).rejects.toThrow(TaskNotReadyError);
  });
});
