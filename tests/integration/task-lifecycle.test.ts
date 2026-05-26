import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { taskCreateTool } from "../../src/tools/task-create.js";
import { taskListTool } from "../../src/tools/task-list.js";
import { taskUpdateTool } from "../../src/tools/task-update.js";
import { taskClaimTool } from "../../src/tools/task-claim.js";

describe("integration — task lifecycle: create → list → claim → update → complete", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-int-tl-"));
    mkdirSync(join(vaultPath, "wikis", "alpha", "tasks"), { recursive: true });
    // Create a fire-type charmander profile so type-restriction checks pass
    const profilesDir = join(vaultPath, "wikis", "_agents", "profiles");
    mkdirSync(profilesDir, { recursive: true });
    writeFileSync(join(profilesDir, "profile-charmander.md"),
      `---
id: profile-charmander
title: Charmander
type: profile
wiki: _agents
status: active
created: 2026-04-29
updated: 2026-04-29
summary: Backend
pokemon_type: fire
evolution_stage: basic
autonomy_level: restricted
moveset: []
applies_to: [claude-code]
---
`);
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("happy path", async () => {
    // Create
    const created = await taskCreateTool.handler({
      title: "feat-x: API surface",
      wiki: "alpha",
      segregation: ["packages/api/**"],
      required_pokemon_type: "fire",
      channel: "feat-x-progress"
    }, { vaultPath });

    // List — should be 1 pending fire-type task
    const pending = await taskListTool.handler({
      wiki: "alpha", status: "pending", pokemon_type: "fire"
    }, { vaultPath });
    expect(pending.tasks).toHaveLength(1);
    expect(pending.tasks[0].id).toBe(created.id);

    // Claim
    const claim = await taskClaimTool.handler({
      task_id: created.id,
      expected_updated: created.updated, wiki: "alpha"
    }, { vaultPath, principal: { agent_id: "charmander" } });
    expect(claim.claimed_by).toBe("agent:charmander");

    // Update to in_progress
    const update = await taskUpdateTool.handler({
      task_id: created.id, wiki: "alpha",
      expected_updated: claim.updated,
      status: "in_progress",
      notes: "started; tests at /api/v1",
    }, { vaultPath, principal: { agent_id: "agent:charmander" } });
    expect(update.status).toBe("in_progress");

    // Complete
    const complete = await taskUpdateTool.handler({
      task_id: created.id, wiki: "alpha",
      expected_updated: update.updated,
      status: "completed",
    }, { vaultPath, principal: { agent_id: "agent:charmander" } });
    expect(complete.status).toBe("completed");

    // Final list — should show 0 pending
    const finalPending = await taskListTool.handler({
      wiki: "alpha", status: "pending"
    }, { vaultPath });
    expect(finalPending.tasks).toHaveLength(0);
  });
});
