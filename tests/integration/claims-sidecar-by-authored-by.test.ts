// vault-mcp/tests/integration/claims-sidecar-by-authored-by.test.ts
//
// task-sidecar-bucket — verifies that `buildClaimsIndex` populates the new
// `by_authored_by` bucket from each claim's `authored_by` frontmatter field,
// and that the emitted sidecar carries `schema_version: 2`.
//
// Plan ref: task-sidecar-bucket (claims sidecar type consolidation).

import { describe, it, expect } from "vitest";
import { buildClaimsIndex } from "../../src/core/claims-index.js";
import { mkTempVault, writeClaimFile } from "../helpers.js";

describe("claims sidecar — by_authored_by bucket", () => {
  it("populates by_authored_by from claims' authored_by frontmatter", async () => {
    const vault = await mkTempVault();

    await writeClaimFile(vault, {
      id: "claim-a",
      key: "alpha.a",
      status: "active",
      confidence: 0.8,
      profile: ["profile-charmander"],
      authored_by: "agent:charmander",
    });
    await writeClaimFile(vault, {
      id: "claim-b",
      key: "alpha.b",
      status: "active",
      confidence: 0.8,
      profile: ["profile-pidgey"],
      authored_by: "agent:pidgey",
    });
    await writeClaimFile(vault, {
      id: "claim-c",
      key: "alpha.c",
      status: "active",
      confidence: 0.8,
      profile: ["profile-charmander"],
      authored_by: "human:brett",
    });

    const idx = await buildClaimsIndex(vault);

    expect(idx.by_authored_by["agent:charmander"]).toContain("claim-a");
    expect(idx.by_authored_by["agent:pidgey"]).toContain("claim-b");
    expect(idx.by_authored_by["human:brett"]).toContain("claim-c");
    expect(idx.schema_version).toBe(3);
  });

  it("omits a claim from by_authored_by when authored_by is empty or absent", async () => {
    const vault = await mkTempVault();

    await writeClaimFile(vault, {
      id: "claim-no-author",
      key: "alpha.noauth",
      status: "active",
      confidence: 0.8,
      profile: ["profile-charmander"],
      authored_by: "",
    });

    const idx = await buildClaimsIndex(vault);

    // No entry should exist for an empty string key
    expect(idx.by_authored_by[""]).toBeUndefined();
  });

  it("groups multiple claims from the same author under one key", async () => {
    const vault = await mkTempVault();

    await writeClaimFile(vault, {
      id: "claim-x",
      key: "alpha.x",
      status: "active",
      confidence: 0.8,
      profile: ["profile-charmander"],
      authored_by: "agent:charmander",
    });
    await writeClaimFile(vault, {
      id: "claim-y",
      key: "alpha.y",
      status: "active",
      confidence: 0.8,
      profile: ["profile-charmander"],
      authored_by: "agent:charmander",
    });

    const idx = await buildClaimsIndex(vault);

    expect(idx.by_authored_by["agent:charmander"]).toContain("claim-x");
    expect(idx.by_authored_by["agent:charmander"]).toContain("claim-y");
    expect(idx.by_authored_by["agent:charmander"]).toHaveLength(2);
  });

  it("skips non-active claims from by_authored_by", async () => {
    const vault = await mkTempVault();

    await writeClaimFile(vault, {
      id: "claim-active-auth",
      key: "alpha.act",
      status: "active",
      confidence: 0.8,
      profile: ["profile-charmander"],
      authored_by: "agent:charmander",
    });
    await writeClaimFile(vault, {
      id: "claim-super-auth",
      key: "alpha.sup",
      status: "superseded",
      confidence: 0.8,
      profile: ["profile-charmander"],
      authored_by: "agent:charmander",
      superseded_by: "claim-active-auth",
    });

    const idx = await buildClaimsIndex(vault);

    // Only active claims land in any bucket
    expect(idx.by_authored_by["agent:charmander"]).toEqual(["claim-active-auth"]);
  });
});
