import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { lintCheckRegistry, runRegisteredChecks } from "../../src/core/lint-check.js";
import type { LintInput } from "../../src/core/lint.js";
import type { VaultIndex } from "../../src/core/index.js";

// Hermeticity: capture the registry length before our side-effect imports run
// and splice back afterwards. Same pattern as lint-check.test.ts. We use
// dynamic imports so the snapshot is taken before any stub registers.
describe("lint-check stubs (Plan A Task 1-5)", () => {
  let initialLength: number;
  const expectedCodes = [
    "CROSS_WIKI_LINK_BROKEN",
    "THRESHOLD_BLOCK_INVALID",
    "ACTIVE_WIKI_DIVERGENCE",
    "DEPLOYMENT_DRIFT",
    "AGENT_ATTRIBUTION_DRIFT",
  ];

  beforeAll(async () => {
    initialLength = lintCheckRegistry.length;
    await import("../../src/core/lint-checks/cross-wiki-link-broken.js");
    await import("../../src/core/lint-checks/threshold-block-invalid.js");
    await import("../../src/core/lint-checks/active-wiki-divergence.js");
    await import("../../src/core/lint-checks/deployment-drift.js");
    await import("../../src/core/lint-checks/agent-attribution-aware.js");
  });

  afterAll(() => {
    lintCheckRegistry.splice(initialLength, lintCheckRegistry.length - initialLength);
  });

  it("registers exactly five new checks (idempotent on re-import)", () => {
    // ESM module cache means re-importing is a no-op; if a stub were imported
    // twice somewhere, we'd see >5 here.
    expect(lintCheckRegistry.length - initialLength).toBe(5);
  });

  it("registers each of the five expected diagnostic codes", () => {
    const newCodes = lintCheckRegistry.slice(initialLength).map(c => c.code);
    for (const code of expectedCodes) {
      expect(newCodes).toContain(code);
    }
  });

  it("running all stubs produces zero diagnostics (Wave 3 fills bodies)", () => {
    const emptyIdx: VaultIndex = { wikis: [], pages: [], links: {} };
    const emptyInput: LintInput = {};
    const out = runRegisteredChecks({ vaultPath: "/tmp/vault" }, emptyIdx, emptyInput);
    // Other tests' registered checks may still be present; assert that
    // OUR five stubs contribute nothing. Filter to expectedCodes only.
    const ours = out.filter(d => expectedCodes.includes(d.code));
    expect(ours).toEqual([]);
  });
});
