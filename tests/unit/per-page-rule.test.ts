import { describe, it, expect } from "vitest";
import type { PerPageRule } from "../../src/core/lint-checks/per-page-rule.js";
import { claimWithoutEvidence } from "../../src/core/lint-checks/claim-without-evidence.js";

describe("PerPageRule type module", () => {
  it("existing claim rules conform to the canonical PerPageRule shape", () => {
    const r: PerPageRule = claimWithoutEvidence;
    expect(r.id).toBe("claim-without-evidence");
    expect(typeof r.appliesTo).toBe("function");
    expect(typeof r.check).toBe("function");
  });
});
