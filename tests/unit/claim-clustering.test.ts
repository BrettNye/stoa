// vault-mcp/tests/unit/claim-clustering.test.ts
//
// task-claim-clustering-helpers — pure clusterByTag + sidecar/disk-walk
// loadActiveProfileClaims. Drift: ParsedClaim is flat (extends
// ClaimFrontmatter), so cluster keys live at `c.tags` not `c.frontmatter.tags`.
// ClaimsStore.read takes (vaultPath, claimId) — adjusted accordingly.

import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  clusterByTag,
  loadActiveProfileClaims,
} from "../../src/core/claim-clustering.js";
import type { ParsedClaim } from "../../src/core/claims.js";
import type { ClaimsConfig } from "../../src/config.js";
import { ClaimsConfigSchema } from "../../src/config.js";
import {
  mkTempVault,
  mkTempVaultWithSidecar,
  writeClaimFile,
  type ClaimFixtureInput,
} from "../helpers.js";

const TODAY = new Date("2026-05-03T00:00:00Z");

const defaultConfig: ClaimsConfig = ClaimsConfigSchema.parse({});

function fakeParsed(
  id: string,
  tags: string[],
  overrides: Partial<ParsedClaim> = {},
): ParsedClaim {
  return {
    id,
    type: "claim",
    title: id,
    created: "2026-05-02",
    key: "k.x",
    confidence: 0.9,
    last_validated: "2026-05-02",
    profile: [],
    move: [],
    scope_wiki: [],
    tags,
    evidence: [],
    status: "active",
    supersedes: [],
    superseded_by: null,
    retracted_at: null,
    retracted_by: null,
    retraction_reason: null,
    body: "",
    filePath: `<test:${id}>`,
    mtime: "2026-05-02T00:00:00.000Z",
    ...overrides,
  } as ParsedClaim;
}

describe("clusterByTag", () => {
  it("returns an empty Map for empty input", () => {
    const buckets = clusterByTag([], 5);
    expect(buckets.size).toBe(0);
  });

  it("contributes a multi-tagged claim to every one of its buckets", () => {
    const claims = [fakeParsed("c1", ["a", "b", "c"])];
    const buckets = clusterByTag(claims, 1);
    expect(buckets.has("a")).toBe(true);
    expect(buckets.has("b")).toBe(true);
    expect(buckets.has("c")).toBe(true);
    expect(buckets.get("a")![0].id).toBe("c1");
    expect(buckets.get("b")![0].id).toBe("c1");
    expect(buckets.get("c")![0].id).toBe("c1");
  });

  it("drops buckets below minCluster", () => {
    const claims = [
      fakeParsed("c1", ["a", "b"]),
      fakeParsed("c2", ["a"]),
      fakeParsed("c3", ["a"]),
    ];
    const buckets = clusterByTag(claims, 3);
    expect(buckets.has("a")).toBe(true);
    expect(buckets.get("a")!.length).toBe(3);
    expect(buckets.has("b")).toBe(false);
  });

  it("keeps buckets at exactly minCluster", () => {
    const claims = [
      fakeParsed("c1", ["a"]),
      fakeParsed("c2", ["a"]),
    ];
    const buckets = clusterByTag(claims, 2);
    expect(buckets.has("a")).toBe(true);
    expect(buckets.get("a")!.length).toBe(2);
  });

  it("treats absent tags array as no contribution", () => {
    // Defensive: a malformed-but-still-typed claim with tags=[] (the schema
    // default) must not throw and must not appear in any bucket.
    const claims = [fakeParsed("c1", [])];
    const buckets = clusterByTag(claims, 1);
    expect(buckets.size).toBe(0);
  });

  it("is order-independent: same inputs produce equal Map contents regardless of order", () => {
    const a = fakeParsed("a", ["t1", "t2"]);
    const b = fakeParsed("b", ["t1"]);
    const c = fakeParsed("c", ["t1", "t2"]);

    const ordered = clusterByTag([a, b, c], 2);
    const reversed = clusterByTag([c, b, a], 2);

    // Same set of keys.
    expect(new Set(ordered.keys())).toEqual(new Set(reversed.keys()));
    // Same set of claim ids in each surviving bucket.
    for (const k of ordered.keys()) {
      const orderedIds = new Set(ordered.get(k)!.map((x) => x.id));
      const reversedIds = new Set(reversed.get(k)!.map((x) => x.id));
      expect(orderedIds).toEqual(reversedIds);
    }
  });
});

describe("loadActiveProfileClaims", () => {
  it("uses the sidecar's by_profile index when present", async () => {
    const fixtures: ClaimFixtureInput[] = [
      {
        id: "claim-pikachu-1",
        key: "k.a",
        status: "active",
        confidence: 0.9,
        last_validated: "2026-05-02",
        profile: ["profile-pikachu"],
        tags: ["t1"],
      },
      {
        id: "claim-other-1",
        key: "k.b",
        status: "active",
        confidence: 0.9,
        last_validated: "2026-05-02",
        profile: ["profile-bulbasaur"],
        tags: ["t1"],
      },
    ];
    const vault = await mkTempVaultWithSidecar(fixtures);

    const out = await loadActiveProfileClaims(
      vault,
      "profile-pikachu",
      TODAY,
      defaultConfig,
    );
    expect(out.length).toBe(1);
    expect(out[0].id).toBe("claim-pikachu-1");
  });

  it("falls back to disk walk when the sidecar is absent", async () => {
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-disk-1",
      key: "k.a",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      profile: ["profile-pikachu"],
      tags: ["t1"],
    });
    await writeClaimFile(vault, {
      id: "claim-disk-2",
      key: "k.b",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      profile: ["profile-bulbasaur"],
      tags: ["t1"],
    });
    // No _index/claims.json present.

    const out = await loadActiveProfileClaims(
      vault,
      "profile-pikachu",
      TODAY,
      defaultConfig,
    );
    expect(out.length).toBe(1);
    expect(out[0].id).toBe("claim-disk-1");
  });

  it("honors sidecar silence for an unknown profileId (no disk-walk fallback)", async () => {
    // Sidecar present (built from no-profile claims) but `profile-ghost` not indexed.
    const vault = await mkTempVaultWithSidecar([]);
    await writeClaimFile(vault, {
      id: "claim-ghost-1",
      key: "k.a",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      profile: ["profile-ghost"],
    });

    const out = await loadActiveProfileClaims(
      vault,
      "profile-ghost",
      TODAY,
      defaultConfig,
    );
    // Sidecar said empty for this profile; the empty list is authoritative.
    expect(out.length).toBe(0);
  });

  it("excludes non-active claims even if present in the sidecar entry", async () => {
    // Build a vault with an active and a superseded claim, then poison the
    // sidecar so it lists both for the profile.
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-active",
      key: "k.a",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      profile: ["profile-pikachu"],
    });
    await writeClaimFile(vault, {
      id: "claim-superseded",
      key: "k.b",
      status: "superseded",
      confidence: 0.9,
      last_validated: "2026-05-02",
      profile: ["profile-pikachu"],
      superseded_by: "claim-active",
    });
    await fs.writeFile(
      path.join(vault, "_index", "claims.json"),
      JSON.stringify({
        by_profile: { "profile-pikachu": ["claim-active", "claim-superseded"] },
      }),
      "utf8",
    );

    const out = await loadActiveProfileClaims(
      vault,
      "profile-pikachu",
      TODAY,
      defaultConfig,
    );
    expect(out.map((c) => c.id)).toEqual(["claim-active"]);
  });

  it("excludes claims whose profile array does not contain the requested profileId", async () => {
    // Sidecar lies — claims it for profile-pikachu — but the on-disk
    // frontmatter says otherwise. Loader must trust the file, not the index.
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-mislabeled",
      key: "k.a",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      profile: ["profile-bulbasaur"],
    });
    await fs.writeFile(
      path.join(vault, "_index", "claims.json"),
      JSON.stringify({
        by_profile: { "profile-pikachu": ["claim-mislabeled"] },
      }),
      "utf8",
    );

    const out = await loadActiveProfileClaims(
      vault,
      "profile-pikachu",
      TODAY,
      defaultConfig,
    );
    expect(out.length).toBe(0);
  });

  it("excludes claims whose effectiveConfidence is below render_min_confidence", async () => {
    // Two claims, same profile. One has high confidence and recent validation;
    // the other has stored confidence below the threshold to begin with.
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-strong",
      key: "k.a",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      profile: ["profile-pikachu"],
    });
    await writeClaimFile(vault, {
      id: "claim-weak",
      key: "k.b",
      status: "active",
      confidence: 0.2, // below default render_min_confidence (0.4) even fresh
      last_validated: "2026-05-02",
      profile: ["profile-pikachu"],
    });

    const out = await loadActiveProfileClaims(
      vault,
      "profile-pikachu",
      TODAY,
      defaultConfig,
    );
    expect(out.map((c) => c.id)).toEqual(["claim-strong"]);
  });

  it("respects an injected today and a custom render_min_confidence", async () => {
    const vault = await mkTempVault();
    // Stored 0.5, half_life=10, today is 100 days later → factor hits floor
    // (effective_floor=0.1) → effective ≈ 0.05 → below render_min_confidence
    // even at the default 0.4. With a low render_min_confidence (0.01) it
    // should pass.
    await writeClaimFile(vault, {
      id: "claim-decayed",
      key: "k.a",
      status: "active",
      confidence: 0.5,
      last_validated: "2026-01-23", // 100 days before TODAY=2026-05-03
      profile: ["profile-pikachu"],
    });

    const strict = await loadActiveProfileClaims(
      vault,
      "profile-pikachu",
      TODAY,
      { ...defaultConfig, half_life_days: 10, render_min_confidence: 0.4 },
    );
    expect(strict.length).toBe(0);

    const lax = await loadActiveProfileClaims(
      vault,
      "profile-pikachu",
      TODAY,
      { ...defaultConfig, half_life_days: 10, render_min_confidence: 0.01 },
    );
    expect(lax.length).toBe(1);
    expect(lax[0].id).toBe("claim-decayed");
  });

  it("returns ParsedClaim shape (flat frontmatter + body/filePath/mtime)", async () => {
    const vault = await mkTempVaultWithSidecar([
      {
        id: "claim-shape",
        key: "k.a",
        status: "active",
        confidence: 0.9,
        last_validated: "2026-05-02",
        profile: ["profile-pikachu"],
        tags: ["shape"],
      },
    ]);
    const out = await loadActiveProfileClaims(
      vault,
      "profile-pikachu",
      TODAY,
      defaultConfig,
    );
    expect(out.length).toBe(1);
    const c = out[0];
    expect(c.id).toBe("claim-shape");
    expect(c.tags).toEqual(["shape"]);
    expect(typeof c.body).toBe("string");
    expect(typeof c.filePath).toBe("string");
    expect(typeof c.mtime).toBe("string");
  });
});
