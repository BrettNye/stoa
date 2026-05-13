import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ZodError } from "zod";
import { refreshProfileMemoryTool } from "../../src/tools/refresh-profile-memory.js";
import { reindex } from "../../src/core/reindex.js";

describe("refresh-profile-memory rename: pokemon_id → agent_id", () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-rpm-rename-"));
    const profilesDir = join(vaultPath, "wikis", "_agents", "profiles");
    mkdirSync(profilesDir, { recursive: true });
    mkdirSync(join(vaultPath, "wikis", "_agents", "synthesis"), { recursive: true });
    mkdirSync(join(vaultPath, "wikis", "_agents", "journal"), { recursive: true });
    mkdirSync(join(vaultPath, "_index"), { recursive: true });

    writeFileSync(
      join(profilesDir, "charmander.md"),
      `---
id: charmander
title: Charmander
type: profile
wiki: _agents
status: active
created: 2026-05-13
updated: 2026-05-13
summary: Test agent
pokemon_type: fire
evolution_stage: basic
autonomy_level: restricted
moveset: []
applies_to: [claude-code]
---
`
    );

    writeFileSync(
      join(vaultPath, "wikis", "_agents", "journal", "journal-2026-05-13-1000-test.md"),
      `---
id: journal-2026-05-13-1000-test
title: Test journal
type: journal
wiki: _agents
created: 2026-05-13T10:00:00Z
author: agent:charmander
---
charmander test journal
`
    );

    await reindex(vaultPath);
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("accepts agent_id (new schema field name)", async () => {
    const r = await refreshProfileMemoryTool.handler(
      { agent_id: "charmander", wiki: "_agents" },
      { vaultPath }
    );
    expect(r.memory_page_id).toBe("synthesis-charmander-memory");
    expect(r.path).toContain("synthesis-charmander-memory.md");
    expect(r.inputs_used_count).toBeGreaterThanOrEqual(0);
  });

  it("rejects pokemon_id (old schema) at Zod parse — agent_id is required", async () => {
    // Passing pokemon_id instead of agent_id — Zod will reject because agent_id is missing
    await expect(
      refreshProfileMemoryTool.handler(
        { pokemon_id: "charmander", wiki: "_agents" } as any,
        { vaultPath }
      )
    ).rejects.toThrow(ZodError);
  });

  it("input schema field is named agent_id not pokemon_id", () => {
    // Verify the Zod schema shape directly
    const schema = (refreshProfileMemoryTool as any).inputSchema;
    // agent_id must be in the shape
    const parseResult = schema.safeParse({ agent_id: "charmander", wiki: "_agents" });
    expect(parseResult.success).toBe(true);

    // pokemon_id alone must NOT satisfy the schema (agent_id is required)
    const rejectResult = schema.safeParse({ pokemon_id: "charmander", wiki: "_agents" });
    expect(rejectResult.success).toBe(false);
    if (!rejectResult.success) {
      const fieldNames = rejectResult.error.issues.map((i: any) => i.path[0]);
      expect(fieldNames).toContain("agent_id");
    }
  });
});
