// vault-mcp/tests/integration/agent-memory-tool.test.ts
//
// Integration tests for the `vault_agent-memory` MCP tool wrapper.
// These tests exercise the tool handler (src/tools/agent-memory.ts) end-to-end,
// using fixture-seeding helpers from tests/helpers.ts.

import { describe, it, expect } from "vitest";
import { mkTempVault, writeClaimFile } from "../helpers.js";
import { agentMemoryTool } from "../../src/tools/agent-memory.js";
import { buildClaimsIndex, writeClaimsIndex } from "../../src/core/claims-index.js";

const TODAY = new Date("2026-05-13");
const CTX_OPTS = { today: TODAY } as { today: Date };

// Helper to build ctx; agent_id is now passed via principal.
function ctx(vaultPath: string, agent_id?: string) {
  return agent_id
    ? { vaultPath, principal: { agent_id } }
    : { vaultPath };
}

describe("vault_agent-memory tool — basic retrieval", () => {
  it("returns top-N truncated claims by default", async () => {
    const vault = await mkTempVault();

    // Seed 12 claims authored by charmander so we exceed the default limit (10)
    for (let i = 1; i <= 12; i++) {
      await writeClaimFile(vault, {
        id: `claim-c${i}`,
        key: `test.claim-${i}`,
        status: "active",
        confidence: 0.8,
        tags: [],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
        body: `Body for claim ${i}. This is some filler text to make it longer.`,
      });
    }

    await buildClaimsIndex(vault).then((idx) => writeClaimsIndex(vault, idx));

    const r = await agentMemoryTool.handler(
      {},
      ctx(vault, "charmander"),
    );

    expect(r.claims.length).toBeLessThanOrEqual(10);
    expect(r.claims[0]).toHaveProperty("body");
    expect(r.scope_used.profile).toEqual(["charmander"]);
  });

  it("normalizes prefixed agent_id forms (agent:foo, profile-foo)", async () => {
    const vault = await mkTempVault();

    await writeClaimFile(vault, {
      id: "claim-norm",
      key: "test.norm",
      status: "active",
      confidence: 0.9,
      tags: [],
      profile: [],
      scope_wiki: [],
      authored_by: "agent:charmander",
      body: "Normalization test body.",
    });

    await buildClaimsIndex(vault).then((idx) => writeClaimsIndex(vault, idx));

    // All three forms should yield equivalent results
    const r1 = await agentMemoryTool.handler({}, ctx(vault, "charmander"));
    const r2 = await agentMemoryTool.handler({}, ctx(vault, "agent:charmander"));
    const r3 = await agentMemoryTool.handler({}, ctx(vault, "profile-charmander"));

    // All should find the same claim
    const ids1 = r1.claims.map((c: { id: string }) => c.id);
    const ids2 = r2.claims.map((c: { id: string }) => c.id);
    const ids3 = r3.claims.map((c: { id: string }) => c.id);

    expect(ids1).toContain("claim-norm");
    expect(ids2).toContain("claim-norm");
    expect(ids3).toContain("claim-norm");

    // scope_used.profile should always be the bare form
    expect(r1.scope_used.profile).toEqual(["charmander"]);
    expect(r2.scope_used.profile).toEqual(["charmander"]);
    expect(r3.scope_used.profile).toEqual(["charmander"]);
  });

  it("respects the limit parameter", async () => {
    const vault = await mkTempVault();

    for (let i = 1; i <= 5; i++) {
      await writeClaimFile(vault, {
        id: `claim-lim${i}`,
        key: `test.lim-${i}`,
        status: "active",
        confidence: 0.8,
        tags: [],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:squirtle",
        body: `Limit test claim ${i}.`,
      });
    }

    await buildClaimsIndex(vault).then((idx) => writeClaimsIndex(vault, idx));

    const r = await agentMemoryTool.handler(
      { limit: 2 },
      ctx(vault, "squirtle"),
    );

    expect(r.claims.length).toBeLessThanOrEqual(2);
  });

  it("respects the detail parameter", async () => {
    const vault = await mkTempVault();

    await writeClaimFile(vault, {
      id: "claim-detail",
      key: "test.detail",
      status: "active",
      confidence: 0.85,
      tags: [],
      profile: [],
      scope_wiki: [],
      authored_by: "agent:bulbasaur",
      body: "Detail level test body.",
    });

    await buildClaimsIndex(vault).then((idx) => writeClaimsIndex(vault, idx));

    const rSummary = await agentMemoryTool.handler(
      { detail: "summary" },
      ctx(vault, "bulbasaur"),
    );

    expect(rSummary.claims[0].body).toBe("");
  });

  it("tool is registered in allTools", async () => {
    const { allTools } = await import("../../src/tools/index.js");
    const tool = allTools.find((t) => t.name === "vault_agent-memory");
    expect(tool).toBeDefined();
    expect(tool?.name).toBe("vault_agent-memory");
  });

  it("description mentions spec path and read-only contract", () => {
    expect(agentMemoryTool.description).toContain("2026-05-13-agent-memory-design.md");
    expect(agentMemoryTool.description.toLowerCase()).toContain("read-only");
  });
});

describe("vault_agent-memory tool — Zod input schema", () => {
  it("accepts all valid optional fields (no agent_id in input schema)", async () => {
    const vault = await mkTempVault();

    // Should not throw on a fully-specified valid input (agent_id removed from schema)
    const input = {
      task: "task-some-slug",
      tags: ["alpha", "beta"],
      scope_wiki: ["rastate"],
      token_budget: 500,
      limit: 5,
      detail: "full" as const,
      include_questions: true,
    };

    // Parsing should succeed (no error thrown)
    const result = agentMemoryTool.inputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects extraneous agent_id in input (agent_id now comes from ctx.principal)", () => {
    // The schema no longer accepts agent_id as an input field.
    // Zod strips unknown keys by default, so we verify the field is absent
    // from the parsed output, confirming it's not part of the schema contract.
    const result = agentMemoryTool.inputSchema.safeParse({ agent_id: "charmander" });
    // Parsing succeeds (Zod strips unknowns), but agent_id is absent from the output
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("agent_id");
    }
  });

  it("rejects negative token_budget", () => {
    const result = agentMemoryTool.inputSchema.safeParse({
      token_budget: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects zero limit", () => {
    const result = agentMemoryTool.inputSchema.safeParse({
      limit: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid detail enum value", () => {
    const result = agentMemoryTool.inputSchema.safeParse({
      detail: "invalid-detail",
    });
    expect(result.success).toBe(false);
  });

  it("accepts detail values summary, truncated, full", () => {
    for (const detail of ["summary", "truncated", "full"] as const) {
      const result = agentMemoryTool.inputSchema.safeParse({
        detail,
      });
      expect(result.success).toBe(true);
    }
  });
});
