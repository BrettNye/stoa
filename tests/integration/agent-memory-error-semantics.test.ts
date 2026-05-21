// vault-mcp/tests/integration/agent-memory-error-semantics.test.ts
//
// Covers each row of spec §8.3 error semantics.
// All of these are "no-throw" behaviors: errors surface as empty/degraded
// results, not exceptions.

import { describe, it, expect } from "vitest";
import { mkTempVault, writeClaimFile } from "../helpers.js";
import { agentMemoryTool } from "../../src/tools/agent-memory.js";
import { buildClaimsIndex, writeClaimsIndex } from "../../src/core/claims-index.js";
import { promises as fs } from "node:fs";
import path from "node:path";

const TODAY = new Date("2026-05-13");

// Helper to build ctx; agent_id is now passed via principal (v0.4 calling convention).
function ctx(vaultPath: string, agent_id?: string) {
  return agent_id
    ? { vaultPath, principal: { agent_id } }
    : { vaultPath };
}

describe("vault_agent-memory error semantics (spec §8.3)", () => {
  // Row 1: Nonexistent agent_id → returns empty claims: [], no throw.
  it("returns empty claims for a nonexistent agent_id", async () => {
    const vault = await mkTempVault();
    // Vault has no claims at all

    await expect(
      agentMemoryTool.handler({}, ctx(vault, "agent-does-not-exist")),
    ).resolves.toMatchObject({
      claims: [],
      total_pool_size: 0,
    });
  });

  // Row 2: `task` id that doesn't exist → falls back to non-task scope, no throw.
  it("falls back to non-task scope when task id does not exist", async () => {
    const vault = await mkTempVault();

    await writeClaimFile(vault, {
      id: "claim-fallback",
      key: "test.fallback",
      status: "active",
      confidence: 0.8,
      tags: [],
      profile: [],
      scope_wiki: [],
      authored_by: "agent:pikachu",
      body: "Task fallback test.",
    });

    await buildClaimsIndex(vault).then((idx) => writeClaimsIndex(vault, idx));

    // task id that doesn't exist should not throw and should still return claims
    await expect(
      agentMemoryTool.handler(
        { task: "task-nonexistent-xyz" },
        ctx(vault, "pikachu"),
      ),
    ).resolves.toMatchObject({
      agent_id: "pikachu",
    });

    const result = await agentMemoryTool.handler(
      { task: "task-nonexistent-xyz" },
      ctx(vault, "pikachu"),
    );
    // Should not throw; may return claims from non-task scope
    expect(result.claims).toBeDefined();
    expect(Array.isArray(result.claims)).toBe(true);
  });

  // Row 3: Missing `_index/claims.json` → triggers disk walk path; verify result still computed.
  it("computes result via disk walk when claims sidecar is missing", async () => {
    const vault = await mkTempVault();

    await writeClaimFile(vault, {
      id: "claim-no-sidecar",
      key: "test.no-sidecar",
      status: "active",
      confidence: 0.8,
      tags: [],
      profile: [],
      scope_wiki: [],
      authored_by: "agent:geodude",
      body: "Missing sidecar test.",
    });

    // Ensure no sidecar exists
    try {
      await fs.unlink(path.join(vault, "_index", "claims.json"));
    } catch {
      // didn't exist anyway
    }

    const result = await agentMemoryTool.handler(
      {},
      ctx(vault, "geodude"),
    );

    expect(result.claims.map((c: { id: string }) => c.id)).toContain("claim-no-sidecar");
  });

  // Row 4: Stale sidecar (schema_version: 1, no by_authored_by) → fallback, results correct.
  it("falls back to disk walk for authored_by when sidecar has schema_version: 1", async () => {
    const vault = await mkTempVault();

    await writeClaimFile(vault, {
      id: "claim-stale-v1",
      key: "test.stale-v1",
      status: "active",
      confidence: 0.75,
      tags: [],
      profile: [],
      scope_wiki: [],
      authored_by: "agent:onix",
      body: "Stale sidecar fallback test.",
    });

    // Write a schema_version: 1 sidecar (no by_authored_by bucket)
    const staleSidecar = {
      by_profile: {} as Record<string, string[]>,
      by_move: {} as Record<string, string[]>,
      by_scope_wiki: {} as Record<string, string[]>,
      by_tag: {} as Record<string, string[]>,
      global: ["claim-stale-v1"],
      generated_at: new Date().toISOString(),
      schema_version: 1,
    };

    await fs.writeFile(
      path.join(vault, "_index", "claims.json"),
      JSON.stringify(staleSidecar, null, 2),
      "utf8",
    );

    const result = await agentMemoryTool.handler(
      {},
      ctx(vault, "onix"),
    );

    // Falls back to disk walk for authored_by — should find claim
    expect(result.claims.map((c: { id: string }) => c.id)).toContain("claim-stale-v1");
  });

  // Row 5: Explicit scope_wiki overrides task-derived wiki when both present.
  it("explicit scope_wiki is used even when task is also provided", async () => {
    const vault = await mkTempVault();

    // Claim scoped to "rastate" wiki
    await writeClaimFile(vault, {
      id: "claim-scoped-wiki",
      key: "test.scoped-wiki",
      status: "active",
      confidence: 0.85,
      tags: ["infra"],
      profile: [],
      scope_wiki: ["rastate"],
      authored_by: "agent:test",
      body: "Scoped wiki claim body.",
    });

    // Claim scoped to "other-wiki" — should NOT appear when scope_wiki=["rastate"]
    await writeClaimFile(vault, {
      id: "claim-other-wiki",
      key: "test.other-wiki",
      status: "active",
      confidence: 0.85,
      tags: ["infra"],
      profile: [],
      scope_wiki: ["other-wiki"],
      authored_by: "agent:test",
      body: "Other wiki claim body.",
    });

    await buildClaimsIndex(vault).then((idx) => writeClaimsIndex(vault, idx));

    // Pass both task (which wouldn't restrict wiki) and explicit scope_wiki
    const result = await agentMemoryTool.handler(
      {
        task: "task-does-not-exist",
        scope_wiki: ["rastate"],
        tags: ["infra"],
      },
      ctx(vault, "test"),
    );

    // scope_used should reflect explicit scope_wiki
    expect(result.scope_used.scope_wiki).toEqual(["rastate"]);

    // "rastate" claim should be included; "other-wiki" claim should not
    const ids = result.claims.map((c: { id: string }) => c.id);
    expect(ids).toContain("claim-scoped-wiki");
    expect(ids).not.toContain("claim-other-wiki");
  });
});
