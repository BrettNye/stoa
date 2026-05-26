import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { taskClaimTool } from "../../src/tools/task-claim.js";
import { createTask } from "../../src/core/tasks.js";
import { reindex } from "../../src/core/reindex.js";

describe("vault_task-claim — type restriction + defaultWiki", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-claim-"));
    mkdirSync(join(vaultPath, "wikis", "alpha", "tasks"), { recursive: true });
    const profilesDir = join(vaultPath, "wikis", "_agents", "profiles");
    mkdirSync(profilesDir, { recursive: true });
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
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
    writeFileSync(join(profilesDir, "profile-squirtle.md"),
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
`);
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("allows a fire-type agent to claim a fire-required task", async () => {
    const created = createTask(vaultPath, {
      title: "feat-x: API surface",
      wiki: "alpha",
      required_pokemon_type: "fire"
    });
    const r = await taskClaimTool.handler(
      { task_id: created.id, expected_updated: created.updated, wiki: "alpha" },
      { vaultPath, principal: { agent_id: "charmander" } }
    );
    expect(r.claimed_by).toBe("agent:charmander");
    expect(r.task_id).toBe(created.id);
  });

  it("rejects a water-type agent claiming a fire-required task with WRONG_TYPE", async () => {
    const created = createTask(vaultPath, {
      title: "feat-x: backend service",
      wiki: "alpha",
      required_pokemon_type: "fire"
    });
    await expect(
      taskClaimTool.handler(
        { task_id: created.id, expected_updated: created.updated, wiki: "alpha" },
        { vaultPath, principal: { agent_id: "squirtle" } }
      )
    ).rejects.toThrow(/WRONG_TYPE/);
  });

  it("allows any agent to claim a task with no required_pokemon_type", async () => {
    const created = createTask(vaultPath, { title: "feat-x: anything", wiki: "alpha" });
    const r = await taskClaimTool.handler(
      { task_id: created.id, expected_updated: created.updated, wiki: "alpha" },
      { vaultPath, principal: { agent_id: "squirtle" } }
    );
    expect(r.claimed_by).toBe("agent:squirtle");
  });

  it("uses defaultWiki from ctx when wiki is omitted from input", async () => {
    // Set up a non-alpha wiki to defeat the hardcoded fallback
    mkdirSync(join(vaultPath, "wikis", "gamma", "tasks"), { recursive: true });
    const created = createTask(vaultPath, { title: "ambient-wiki test", wiki: "gamma" });
    const r = await taskClaimTool.handler(
      { task_id: created.id, expected_updated: created.updated },
      { vaultPath, defaultWiki: "gamma", principal: { agent_id: "charmander" } }
    );
    expect(r.claimed_by).toBe("agent:charmander");
  });
});
