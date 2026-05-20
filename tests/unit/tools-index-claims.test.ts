// vault-mcp/tests/unit/tools-index-claims.test.ts
//
// task-tools-index-registration — assert that the two claims-foundation tools
// (`vault.claim`, `vault.list-claims`) are registered in the canonical
// `allTools` array exported from `src/tools/index.ts`. Until this test passes,
// downstream tests using `callTool` would not be able to dispatch to either
// tool through the registry — the tool modules export their handlers, but the
// dispatcher only sees what's wired into `allTools`.
//
// Plan reference:
//   `wikis/_meta/plans/2026-05-02-vault-mcp-claims-plan-1-foundation-dag.md`
//   §task-tools-index-registration.
//
// We intentionally exercise the registration two ways:
//   (a) shape check — `allTools` contains entries with the expected names and
//       both expose a function `handler`.
//   (b) end-to-end dispatch — `callTool` from tests/helpers.ts can invoke each
//       tool with a fresh temp vault, proving the registry name → handler hop
//       works under the same async-import path the rest of the suite uses.

import { describe, it, expect } from "vitest";
import { allTools } from "../../src/tools/index.js";
import { callTool, mkTempVault, mkTempVaultWithSidecar } from "../helpers.js";

describe("tools/index — claims tool registration", () => {
  it("registers vault.claim in allTools with a handler", () => {
    const tool = allTools.find((t) => t.name === "vault.claim");
    expect(tool).toBeDefined();
    expect(typeof tool!.handler).toBe("function");
  });

  it("registers vault.list-claims in allTools with a handler", () => {
    const tool = allTools.find((t) => t.name === "vault.list-claims");
    expect(tool).toBeDefined();
    expect(typeof tool!.handler).toBe("function");
  });

  it("dispatches vault.claim through callTool against a temp vault", async () => {
    const vault = await mkTempVault();
    const result = await callTool(
      "vault.claim",
      {
        key: "registration.smoke",
        title: "registration smoke",
        body: "smoke body",
        confidence: 0.7,
        as: "agent:charmeleon",
      },
      vault,
    );
    expect(result.action).toBe("created");
    expect(typeof result.claim_id).toBe("string");
    expect(result.reindex_recommended).toBe(true);
  });

  it("dispatches vault.list-claims through callTool against a temp vault", async () => {
    // NB (bug-2026-05-19): sidecar buckets are keyed by bare agent ids
    // because vault.claim strips `profile-` / `agent:` before storing.
    // value: filter is normalized the same way in list-claims, so a
    // prefixed query against bare-keyed storage still matches.
    const vault = await mkTempVaultWithSidecar([
      {
        id: "claim-reg-smoke",
        key: "k.smoke",
        profile: ["charmander"],
        confidence: 0.8,
        status: "active",
      },
    ]);
    const result = await callTool(
      "vault.list-claims",
      { by: "profile", value: "profile-charmander", min_effective_confidence: 0, status: ["active"], limit: 50 },
      vault,
    );
    expect(Array.isArray(result.claims)).toBe(true);
    expect(result.claims.length).toBeGreaterThanOrEqual(1);
    expect(result.claims[0].id).toBe("claim-reg-smoke");
  });
});
