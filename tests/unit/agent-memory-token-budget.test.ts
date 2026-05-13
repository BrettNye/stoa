// vault-mcp/tests/unit/agent-memory-token-budget.test.ts
//
// Tests for token budget packing, limit ceiling, body sizing per detail tier,
// and truncated:true signaling.

import { describe, it, expect } from "vitest";
import { mkTempVault, writeClaimFile } from "../helpers.js";
import { agentMemory } from "../../src/core/agent-memory.js";
import { buildClaimsIndex, writeClaimsIndex } from "../../src/core/claims-index.js";

const TODAY = new Date("2026-05-02");

async function seedAndIndex(
  claims: Parameters<typeof writeClaimFile>[1][],
): Promise<string> {
  const vault = await mkTempVault();
  for (const c of claims) await writeClaimFile(vault, c);
  const idx = await buildClaimsIndex(vault);
  await writeClaimsIndex(vault, idx);
  return vault;
}

describe("agent-memory token budget", () => {
  it("limits results to `limit` count when token_budget is not set", async () => {
    const vault = await seedAndIndex(
      Array.from({ length: 15 }, (_, i) => ({
        id: `claim-${String(i).padStart(3, "0")}`,
        key: `test.limit-${i}`,
        status: "active" as const,
        confidence: 0.7,
        tags: [],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
        body: "body text",
      })),
    );

    const result = agentMemory(vault, {
      agent_id: "charmander",
      limit: 5,
      today: TODAY,
    });

    expect(result.claims).toHaveLength(5);
    expect(result.truncated).toBe(true);
    expect(result.total_pool_size).toBe(15);
  });

  it("defaults to limit 10 when neither limit nor token_budget is set", async () => {
    const vault = await seedAndIndex(
      Array.from({ length: 12 }, (_, i) => ({
        id: `claim-default-${String(i).padStart(3, "0")}`,
        key: `test.default-${i}`,
        status: "active" as const,
        confidence: 0.7,
        tags: [],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
        body: "body text",
      })),
    );

    const result = agentMemory(vault, { agent_id: "charmander", today: TODAY });

    expect(result.claims).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });

  it("sets truncated:false when all claims fit within limit", async () => {
    const vault = await seedAndIndex([
      {
        id: "claim-single",
        key: "test.single",
        status: "active",
        confidence: 0.7,
        tags: [],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
        body: "body text",
      },
    ]);

    const result = agentMemory(vault, {
      agent_id: "charmander",
      limit: 10,
      today: TODAY,
    });

    expect(result.claims).toHaveLength(1);
    expect(result.truncated).toBe(false);
  });

  it("packs claims by descending score until token_budget would be exceeded", async () => {
    // Each claim body is ~400 chars → ~100 tokens in truncated mode
    const longBody = "A".repeat(400);
    const vault = await seedAndIndex([
      {
        id: "claim-highest-score",
        key: "test.highest",
        status: "active",
        confidence: 0.9,
        tags: [],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
        body: longBody,
      },
      {
        id: "claim-mid-score",
        key: "test.mid",
        status: "active",
        confidence: 0.7,
        tags: [],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
        body: longBody,
      },
      {
        id: "claim-low-score",
        key: "test.low",
        status: "active",
        confidence: 0.5,
        tags: [],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
        body: longBody,
      },
    ]);

    // token_budget of ~150 tokens should fit the first claim (~100 tokens) but stop before the second
    const result = agentMemory(vault, {
      agent_id: "charmander",
      token_budget: 150,
      today: TODAY,
    });

    expect(result.claims[0].id).toBe("claim-highest-score");
    expect(result.truncated).toBe(true);
    // The second claim would exceed the budget
    expect(result.claims.length).toBeLessThan(3);
  });

  it("detail='summary' returns empty body string", async () => {
    const vault = await seedAndIndex([
      {
        id: "claim-summary-detail",
        key: "test.summary",
        status: "active",
        confidence: 0.7,
        tags: [],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
        body: "This is a long body with lots of text that should be suppressed in summary mode.",
      },
    ]);

    const result = agentMemory(vault, {
      agent_id: "charmander",
      detail: "summary",
      today: TODAY,
    });

    expect(result.claims[0].body).toBe("");
  });

  it("detail='truncated' returns first ~200 chars with (more...) marker when longer", async () => {
    const longBody = "X".repeat(400);
    const vault = await seedAndIndex([
      {
        id: "claim-truncated-detail",
        key: "test.truncated",
        status: "active",
        confidence: 0.7,
        tags: [],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
        body: longBody,
      },
    ]);

    const result = agentMemory(vault, {
      agent_id: "charmander",
      detail: "truncated",
      today: TODAY,
    });

    expect(result.claims[0].body).toContain("(more...)");
    expect(result.claims[0].body.length).toBeLessThan(longBody.length);
  });

  it("detail='truncated' does NOT add (more...) when body fits within 200 chars", async () => {
    const shortBody = "Short body text.";
    const vault = await seedAndIndex([
      {
        id: "claim-short-body",
        key: "test.short",
        status: "active",
        confidence: 0.7,
        tags: [],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
        body: shortBody,
      },
    ]);

    const result = agentMemory(vault, {
      agent_id: "charmander",
      detail: "truncated",
      today: TODAY,
    });

    expect(result.claims[0].body).toBe(shortBody.trim());
    expect(result.claims[0].body).not.toContain("(more...)");
  });

  it("detail='full' returns complete body (up to ~500 token cap)", async () => {
    const mediumBody = "Full body content. ".repeat(30); // ~570 chars, well under the 2000 char (~500 token) cap
    const vault = await seedAndIndex([
      {
        id: "claim-full-detail",
        key: "test.full",
        status: "active",
        confidence: 0.7,
        tags: [],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
        body: mediumBody,
      },
    ]);

    const result = agentMemory(vault, {
      agent_id: "charmander",
      detail: "full",
      today: TODAY,
    });

    expect(result.claims[0].body.length).toBeGreaterThan(200);
    expect(result.claims[0].body).not.toContain("(more...)");
  });

  it("detail='full' caps very long bodies at ~500 tokens (~2000 chars)", async () => {
    const veryLongBody = "W".repeat(5000); // 5000 chars >> 2000
    const vault = await seedAndIndex([
      {
        id: "claim-very-long",
        key: "test.very-long",
        status: "active",
        confidence: 0.7,
        tags: [],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
        body: veryLongBody,
      },
    ]);

    const result = agentMemory(vault, {
      agent_id: "charmander",
      detail: "full",
      today: TODAY,
    });

    // Should be capped at ~2000 chars
    expect(result.claims[0].body.length).toBeLessThanOrEqual(2100); // some slack for the marker
  });

  it("limit acts as a ceiling even when token_budget has room", async () => {
    const vault = await seedAndIndex(
      Array.from({ length: 5 }, (_, i) => ({
        id: `claim-ceiling-${String(i).padStart(3, "0")}`,
        key: `test.ceiling-${i}`,
        status: "active" as const,
        confidence: 0.7,
        tags: [],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
        body: "tiny body",
      })),
    );

    const result = agentMemory(vault, {
      agent_id: "charmander",
      token_budget: 100_000, // huge budget
      limit: 2,
      today: TODAY,
    });

    expect(result.claims).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });
});

describe("agent-memory result shape", () => {
  it("returns required AgentMemoryResult fields", async () => {
    const vault = await seedAndIndex([
      {
        id: "claim-shape",
        key: "test.shape",
        status: "active",
        confidence: 0.7,
        tags: [],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
        body: "body text",
      },
    ]);

    const result = agentMemory(vault, { agent_id: "charmander", today: TODAY });

    expect(result).toHaveProperty("agent_id", "charmander");
    expect(result).toHaveProperty("scope_used");
    expect(result.scope_used).toHaveProperty("tags");
    expect(result.scope_used).toHaveProperty("scope_wiki");
    expect(result.scope_used).toHaveProperty("profile");
    expect(result.scope_used.profile).toContain("charmander");
    expect(result).toHaveProperty("claims");
    expect(result).toHaveProperty("total_pool_size");
    expect(result).toHaveProperty("truncated");
  });

  it("normalizes agent_id by stripping 'agent:' prefix", async () => {
    const vault = await seedAndIndex([
      {
        id: "claim-norm",
        key: "test.norm",
        status: "active",
        confidence: 0.7,
        tags: [],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
        body: "body",
      },
    ]);

    const result = agentMemory(vault, { agent_id: "agent:charmander", today: TODAY });
    expect(result.agent_id).toBe("charmander");
  });

  it("normalizes agent_id by stripping 'profile-' prefix", async () => {
    const vault = await seedAndIndex([
      {
        id: "claim-norm2",
        key: "test.norm2",
        status: "active",
        confidence: 0.7,
        tags: [],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
        body: "body",
      },
    ]);

    const result = agentMemory(vault, { agent_id: "profile-charmander", today: TODAY });
    expect(result.agent_id).toBe("charmander");
  });

  it("returns empty result (no claims) for an unknown agent_id", async () => {
    const vault = await seedAndIndex([
      {
        id: "claim-other-agent",
        key: "test.other",
        status: "active",
        confidence: 0.7,
        tags: [],
        profile: ["pidgey"],
        scope_wiki: [],
        authored_by: "agent:pidgey",
      },
    ]);

    // No claims authored by / targeting / matching scope for "nonexistent"
    const result = agentMemory(vault, { agent_id: "nonexistent", today: TODAY });
    expect(result.claims).toHaveLength(0);
    expect(result.total_pool_size).toBe(0);
  });
});
