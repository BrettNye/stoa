// vault-mcp/tests/integration/agent-memory-sidecar-versioning.test.ts
//
// Verifies:
// 1. When _index/claims.json has schema_version: 1 (no by_authored_by bucket),
//    the authored_by predicate falls back to disk walk.
// 2. When _index/claims.json has schema_version: 2 (with by_authored_by bucket),
//    the authored_by predicate is served from the bucket directly.
// 3. Missing sidecar entirely falls back to disk walk.

import { describe, it, expect } from "vitest";
import { mkTempVault, writeClaimFile } from "../helpers.js";
import { agentMemory } from "../../src/core/agent-memory.js";
import { buildClaimsIndex, writeClaimsIndex } from "../../src/core/claims-index.js";
import { promises as fs } from "node:fs";
import path from "node:path";

const TODAY = new Date("2026-05-02");

describe("sidecar versioning — authored_by predicate fallback", () => {
  it("finds authored_by claims using disk walk when sidecar has schema_version: 1 (no by_authored_by)", async () => {
    const vault = await mkTempVault();

    await writeClaimFile(vault, {
      id: "claim-authored-v1",
      key: "test.v1-authored",
      status: "active",
      confidence: 0.7,
      tags: [],
      profile: [],
      scope_wiki: [],
      authored_by: "agent:charmander",
      body: "authored claim body",
    });

    // Write a schema_version: 1 sidecar (no by_authored_by bucket)
    const oldSidecar = {
      by_profile: {} as Record<string, string[]>,
      by_move: {} as Record<string, string[]>,
      by_scope_wiki: {} as Record<string, string[]>,
      by_tag: {} as Record<string, string[]>,
      global: ["claim-authored-v1"],
      generated_at: new Date().toISOString(),
      schema_version: 1,
    };
    await fs.writeFile(
      path.join(vault, "_index", "claims.json"),
      JSON.stringify(oldSidecar, null, 2),
      "utf8",
    );

    // The authored_by predicate should still find the claim via disk walk
    const result = agentMemory(vault, { agent_id: "charmander", today: TODAY });
    expect(result.claims.map((c) => c.id)).toContain("claim-authored-v1");
  });

  it("finds authored_by claims from sidecar bucket when schema_version: 2", async () => {
    const vault = await mkTempVault();

    await writeClaimFile(vault, {
      id: "claim-authored-v2",
      key: "test.v2-authored",
      status: "active",
      confidence: 0.7,
      tags: [],
      profile: [],
      scope_wiki: [],
      authored_by: "agent:charmander",
      body: "authored claim body v2",
    });

    // Build a proper v2 sidecar with by_authored_by
    const idx = await buildClaimsIndex(vault);
    await writeClaimsIndex(vault, idx);

    expect(idx.schema_version).toBe(2);
    expect(idx.by_authored_by["agent:charmander"]).toContain("claim-authored-v2");

    const result = agentMemory(vault, { agent_id: "charmander", today: TODAY });
    expect(result.claims.map((c) => c.id)).toContain("claim-authored-v2");
  });

  it("falls back to disk walk when sidecar is missing entirely", async () => {
    const vault = await mkTempVault();

    await writeClaimFile(vault, {
      id: "claim-no-sidecar",
      key: "test.no-sidecar",
      status: "active",
      confidence: 0.7,
      tags: [],
      profile: [],
      scope_wiki: [],
      authored_by: "agent:charmander",
      body: "no sidecar body",
    });

    // Explicitly ensure no sidecar exists
    try {
      await fs.unlink(path.join(vault, "_index", "claims.json"));
    } catch {
      // didn't exist anyway
    }

    const result = agentMemory(vault, { agent_id: "charmander", today: TODAY });
    expect(result.claims.map((c) => c.id)).toContain("claim-no-sidecar");
  });

  it("does NOT fall back to disk walk for authored_by when schema_version: 2 — uses bucket only", async () => {
    const vault = await mkTempVault();

    // Write a claim with authored_by
    await writeClaimFile(vault, {
      id: "claim-in-bucket",
      key: "test.in-bucket",
      status: "active",
      confidence: 0.7,
      tags: [],
      profile: [],
      scope_wiki: [],
      authored_by: "agent:charmander",
      body: "in bucket body",
    });

    // Write a separate claim on disk that is NOT in the sidecar (simulates stale scenario)
    await writeClaimFile(vault, {
      id: "claim-not-in-bucket",
      key: "test.not-in-bucket",
      status: "active",
      confidence: 0.7,
      tags: [],
      profile: [],
      scope_wiki: [],
      authored_by: "agent:charmander",
      body: "not in bucket body",
    });

    // Build sidecar only containing the first claim
    const partialSidecar = {
      by_profile: {} as Record<string, string[]>,
      by_move: {} as Record<string, string[]>,
      by_scope_wiki: {} as Record<string, string[]>,
      by_tag: {} as Record<string, string[]>,
      by_authored_by: { "agent:charmander": ["claim-in-bucket"] } as Record<string, string[]>,
      global: [] as string[],
      generated_at: new Date().toISOString(),
      schema_version: 2,
    };
    await fs.writeFile(
      path.join(vault, "_index", "claims.json"),
      JSON.stringify(partialSidecar, null, 2),
      "utf8",
    );

    // With schema_version: 2, it uses the bucket — which only has claim-in-bucket.
    // claim-not-in-bucket should be included because "all claims" are gathered
    // from the union of all predicates. Since the bucket for authored_by gives
    // claim-in-bucket, and the profile + global buckets are also consulted...
    // Actually the spec says: when schema_version: 2 is present, for authored_by
    // predicate we use the bucket, not disk-walk.
    // Both claims have authored_by="agent:charmander" but only claim-in-bucket
    // is in the sidecar bucket. So only that one should surface via authored_by.
    // claim-not-in-bucket has no profile, no scope match (no tags/wiki given),
    // so it's excluded entirely.
    const result = agentMemory(vault, { agent_id: "charmander", today: TODAY });
    expect(result.claims.map((c) => c.id)).toContain("claim-in-bucket");
    expect(result.claims.map((c) => c.id)).not.toContain("claim-not-in-bucket");
  });

  it("profile and global predicates still use sidecar buckets even with old schema_version", async () => {
    const vault = await mkTempVault();

    await writeClaimFile(vault, {
      id: "claim-profile-v1",
      key: "test.profile-v1",
      status: "active",
      confidence: 0.7,
      tags: ["alpha"],
      profile: ["charmander"],
      scope_wiki: [],
      authored_by: "agent:other",
      body: "profile targeted claim",
    });

    // Write schema_version: 1 sidecar with by_profile bucket
    const oldSidecar = {
      by_profile: { charmander: ["claim-profile-v1"] } as Record<string, string[]>,
      by_move: {} as Record<string, string[]>,
      by_scope_wiki: {} as Record<string, string[]>,
      by_tag: { alpha: ["claim-profile-v1"] } as Record<string, string[]>,
      global: [] as string[],
      generated_at: new Date().toISOString(),
      schema_version: 1,
    };
    await fs.writeFile(
      path.join(vault, "_index", "claims.json"),
      JSON.stringify(oldSidecar, null, 2),
      "utf8",
    );

    const result = agentMemory(vault, {
      agent_id: "charmander",
      tags: ["alpha"],
      today: TODAY,
    });
    expect(result.claims.map((c) => c.id)).toContain("claim-profile-v1");
  });
});
