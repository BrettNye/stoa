// vault-mcp/tests/unit/agent-memory-ranking.test.ts
//
// Tests for the ranking formula in agentMemory core:
//   score(C, A, S) = effectiveConfidence(C, today) × (1 + scope_match(C, A, S))
//   scope_match = jaccard(C.tags, S.tags) + jaccard(C.scope_wiki, S.scope_wiki) + (profile_boost ? 0.2 : 0)
// Tie-breaking: alphabetical by claim id.

import { describe, it, expect } from "vitest";
import { mkTempVault, writeClaimFile } from "../helpers.js";
import { agentMemory } from "../../src/core/agent-memory.js";
import { buildClaimsIndex, writeClaimsIndex } from "../../src/core/claims-index.js";

// Fixed "today" for deterministic effective_confidence (no decay from last_validated)
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

describe("agent-memory ranking formula", () => {
  it("ranks by effective_confidence × (1 + scope_match)", async () => {
    const vault = await seedAndIndex([
      {
        id: "claim-off-topic-high-conf",
        key: "test.off-topic",
        status: "active",
        confidence: 0.7,
        tags: [],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
      },
      {
        id: "claim-on-topic-low-conf",
        key: "test.on-topic",
        status: "active",
        confidence: 0.5,
        tags: ["foo"],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
      },
    ]);

    const result = agentMemory(vault, {
      agent_id: "charmander",
      tags: ["foo"],
      today: TODAY,
    });

    // off-topic: 0.7 × 1.0 = 0.70; on-topic: 0.5 × (1 + 1.0) = 1.0
    expect(result.claims[0].id).toBe("claim-on-topic-low-conf");
    expect(result.claims[1].id).toBe("claim-off-topic-high-conf");
  });

  it("applies profile boost of +0.2 to scope_match for profile-targeted claims", async () => {
    const vault = await seedAndIndex([
      {
        id: "claim-no-profile",
        key: "test.no-profile",
        status: "active",
        confidence: 0.8,
        tags: [],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
      },
      {
        id: "claim-with-profile",
        key: "test.with-profile",
        status: "active",
        confidence: 0.75,
        tags: [],
        profile: ["charmander"],
        scope_wiki: [],
        authored_by: "agent:other",
      },
    ]);

    const result = agentMemory(vault, {
      agent_id: "charmander",
      today: TODAY,
    });

    // no-profile: 0.8 × (1 + 0) = 0.80; with-profile: 0.75 × (1 + 0.2) = 0.90
    expect(result.claims[0].id).toBe("claim-with-profile");
    expect(result.claims[1].id).toBe("claim-no-profile");
  });

  it("computes jaccard correctly: empty intersection gives 0", async () => {
    const vault = await seedAndIndex([
      {
        id: "claim-disjoint-tags",
        key: "test.disjoint",
        status: "active",
        confidence: 0.6,
        tags: ["bar", "baz"],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
      },
    ]);

    const result = agentMemory(vault, {
      agent_id: "charmander",
      tags: ["foo"],
      today: TODAY,
    });

    // jaccard(["bar","baz"], ["foo"]) = 0; score = 0.6 × 1.0 = 0.6
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].scope_match_score).toBe(0);
  });

  it("computes jaccard correctly: full overlap gives 1.0", async () => {
    const vault = await seedAndIndex([
      {
        id: "claim-full-overlap",
        key: "test.full",
        status: "active",
        confidence: 0.6,
        tags: ["foo", "bar"],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
      },
    ]);

    const result = agentMemory(vault, {
      agent_id: "charmander",
      tags: ["foo", "bar"],
      today: TODAY,
    });

    expect(result.claims[0].scope_match_score).toBeCloseTo(1.0, 5);
  });

  it("computes jaccard correctly: partial overlap", async () => {
    const vault = await seedAndIndex([
      {
        id: "claim-partial",
        key: "test.partial",
        status: "active",
        confidence: 0.6,
        tags: ["foo", "bar", "baz"],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
      },
    ]);

    const result = agentMemory(vault, {
      agent_id: "charmander",
      tags: ["foo", "qux"],
      today: TODAY,
    });

    // intersection = {foo}, union = {foo, bar, baz, qux} → jaccard = 1/4
    expect(result.claims[0].scope_match_score).toBeCloseTo(0.25, 5);
  });

  it("tie-breaks alphabetically by claim id when scores are equal", async () => {
    const vault = await seedAndIndex([
      {
        id: "claim-zzz",
        key: "test.zzz",
        status: "active",
        confidence: 0.7,
        tags: [],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
      },
      {
        id: "claim-aaa",
        key: "test.aaa",
        status: "active",
        confidence: 0.7,
        tags: [],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
      },
      {
        id: "claim-mmm",
        key: "test.mmm",
        status: "active",
        confidence: 0.7,
        tags: [],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
      },
    ]);

    const result = agentMemory(vault, {
      agent_id: "charmander",
      today: TODAY,
    });

    expect(result.claims[0].id).toBe("claim-aaa");
    expect(result.claims[1].id).toBe("claim-mmm");
    expect(result.claims[2].id).toBe("claim-zzz");
  });

  it("includes scope_wiki in jaccard calculation", async () => {
    const vault = await seedAndIndex([
      {
        id: "claim-wiki-match",
        key: "test.wiki-match",
        status: "active",
        confidence: 0.5,
        tags: [],
        profile: [],
        scope_wiki: ["project-alpha"],
        authored_by: "agent:charmander",
      },
      {
        id: "claim-wiki-miss",
        key: "test.wiki-miss",
        status: "active",
        confidence: 0.8,
        tags: [],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
      },
    ]);

    const result = agentMemory(vault, {
      agent_id: "charmander",
      scope_wiki: ["project-alpha"],
      today: TODAY,
    });

    // wiki-match: 0.5 × (1 + 1.0) = 1.0; wiki-miss: 0.8 × 1.0 = 0.8
    expect(result.claims[0].id).toBe("claim-wiki-match");
  });

  it("returns score and scope_match_score fields on each claim", async () => {
    const vault = await seedAndIndex([
      {
        id: "claim-scored",
        key: "test.scored",
        status: "active",
        confidence: 0.8,
        tags: ["alpha"],
        profile: [],
        scope_wiki: [],
        authored_by: "agent:charmander",
      },
    ]);

    const result = agentMemory(vault, {
      agent_id: "charmander",
      tags: ["alpha"],
      today: TODAY,
    });

    expect(result.claims[0].score).toBeGreaterThan(0);
    expect(result.claims[0].scope_match_score).toBeGreaterThan(0);
    expect(result.claims[0].effective_confidence).toBeCloseTo(0.8, 5);
  });
});
