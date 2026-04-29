import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startTool } from "../../src/tools/start.js";
import { taskCreateTool } from "../../src/tools/task-create.js";
import { taskClaimTool } from "../../src/tools/task-claim.js";

describe("integration — start surfaces map + active + tasks", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-int-start-"));
    mkdirSync(join(vaultPath, "wikis", "alpha", "tasks"), { recursive: true });
    mkdirSync(join(vaultPath, "wikis", "_agents", "profiles"), { recursive: true });
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    writeFileSync(join(vaultPath, "_index", "aliases.json"), "{}");

    writeFileSync(join(vaultPath, "wikis", "alpha", "map.md"),
      `---
id: map-alpha
type: map
title: alpha
created: 2026-04-29
wiki: alpha
status: active
summary: x
updated: 2026-04-29
---

# alpha map

This wiki is in active dev. Look at the spec first.
`);

    writeFileSync(join(vaultPath, "wikis", "_agents", "profiles", "profile-charmander.md"),
      `---
id: profile-charmander
type: profile
title: Charmander
created: 2026-04-29
wiki: _agents
status: active
summary: Backend
pokemon_type: fire
evolution_stage: basic
moveset: []
---

# Charmander
`);
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("with --pokemon includes pokemon_state with active tasks", async () => {
    const t = await taskCreateTool.handler({
      title: "feat-x: API", wiki: "alpha", required_pokemon_type: "fire"
    }, { vaultPath });
    const claim = await taskClaimTool.handler({
      task_id: t.id, agent_id: "charmander",
      expected_updated: t.updated, wiki: "alpha"
    }, { vaultPath });
    // Move to in_progress for the start to see it
    const { taskUpdateTool } = await import("../../src/tools/task-update.js");
    await taskUpdateTool.handler({
      task_id: t.id, wiki: "alpha",
      expected_updated: claim.updated,
      status: "in_progress",
      agent_id: "agent:charmander"
    }, { vaultPath });

    const r = await startTool.handler(
      { wiki: "alpha", pokemon: "profile-charmander" },
      { vaultPath }
    );
    expect(r.map_summary).toContain("alpha map");
    expect(r.pokemon_state).toBeDefined();
    expect(r.pokemon_state?.active_tasks.length).toBeGreaterThan(0);
  });
});
