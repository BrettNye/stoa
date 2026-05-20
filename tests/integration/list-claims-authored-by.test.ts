// vault-mcp/tests/integration/list-claims-authored-by.test.ts
//
// task-list-claims-authored-by — verifies that `vault_list-claims` accepts
// `by: "authored_by"` at the Zod boundary and correctly filters claims via
// the sidecar fast-path, the disk-walk fallback, and rejects unknown `by`
// values at parse time.
//
// Plan ref: task-list-claims-authored-by (claims plan 1, gap-close task).

import { describe, it, expect } from "vitest";
import { callTool, mkTempVault, writeClaimFile } from "../helpers.js";
import { listClaimsTool } from "../../src/tools/list-claims.js";
import { promises as fs } from "node:fs";
import path from "node:path";

describe("vault_list-claims — by=authored_by", () => {
  it("sidecar fast-path: returns only claims with matching authored_by", async () => {
    const vault = await mkTempVault();

    await writeClaimFile(vault, {
      id: "claim-a",
      key: "test.a",
      status: "active",
      confidence: 0.8,
      authored_by: "agent:charmander",
      profile: [],
      move: [],
      scope_wiki: [],
      tags: [],
    });
    await writeClaimFile(vault, {
      id: "claim-b",
      key: "test.b",
      status: "active",
      confidence: 0.8,
      authored_by: "human:brett",
      profile: [],
      move: [],
      scope_wiki: [],
      tags: [],
    });

    // Build sidecar (populates by_authored_by bucket via buildClaimsIndex).
    await callTool("vault_reindex", {}, vault);

    const r = await callTool(
      "vault_list-claims",
      { by: "authored_by", value: "agent:charmander", status: ["active"] },
      vault,
    );

    expect(r.claims).toHaveLength(1);
    expect(r.claims[0].id).toBe("claim-a");
    expect(r.index_age_seconds).not.toBeNull();
  });

  it("disk-walk fallback: matchesBucket authored_by case fires when sidecar is absent", async () => {
    const vault = await mkTempVault();

    await writeClaimFile(vault, {
      id: "claim-x",
      key: "test.x",
      status: "active",
      confidence: 0.8,
      authored_by: "agent:squirtle",
      profile: [],
      move: [],
      scope_wiki: [],
      tags: [],
    });
    await writeClaimFile(vault, {
      id: "claim-y",
      key: "test.y",
      status: "active",
      confidence: 0.8,
      authored_by: "agent:bulbasaur",
      profile: [],
      move: [],
      scope_wiki: [],
      tags: [],
    });

    // Deliberately DO NOT call vault_reindex — no sidecar exists.
    // The disk-walk fallback path triggers matchesBucket for authored_by.
    const sidecarPath = path.join(vault, "_index", "claims.json");
    await expect(fs.stat(sidecarPath)).rejects.toThrow();

    const r = await callTool(
      "vault_list-claims",
      { by: "authored_by", value: "agent:squirtle", status: ["active"] },
      vault,
    );

    expect(r.claims).toHaveLength(1);
    expect(r.claims[0].id).toBe("claim-x");
    expect(r.index_age_seconds).toBeNull();
  });

  it("typo guard: unknown by= value is rejected at Zod parse boundary", () => {
    // Test the inputSchema directly — callTool bypasses Zod by calling
    // handler() directly, so we parse at the schema level to verify the enum
    // is exact-match. "author_by" (missing d) must be an enum error.
    const result = listClaimsTool.inputSchema.safeParse({
      by: "author_by",
      value: "agent:charmander",
      status: ["active"],
    });
    expect(result.success).toBe(false);
  });

  it("Zod schema accepts authored_by without error", () => {
    // Confirm the new enum value is accepted at parse time.
    const result = listClaimsTool.inputSchema.safeParse({
      by: "authored_by",
      value: "agent:charmander",
      status: ["active"],
    });
    expect(result.success).toBe(true);
  });
});
