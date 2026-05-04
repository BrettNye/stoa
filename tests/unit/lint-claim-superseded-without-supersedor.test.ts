// vault-mcp/tests/unit/lint-claim-superseded-without-supersedor.test.ts
//
// Unit tests for the claim-superseded-without-supersedor lint rule per Plan 1
// §task-lint-superseded-no-supersedor. The rule exists as a corpus-integrity
// guard for the case when ClaimSuperseded's Zod schema (which requires
// superseded_by: string) is bypassed by hand-edits or git-merge artifacts.

import { describe, it, expect } from "vitest";
import { claimSupersededWithoutSupersedor } from "../../src/core/lint-checks/claim-superseded-without-supersedor.js";
import { makePage } from "../helpers.js";

describe("claim-superseded-without-supersedor", () => {
  it("has the expected rule id and severity", () => {
    expect(claimSupersededWithoutSupersedor.id).toBe(
      "claim-superseded-without-supersedor"
    );
    expect(claimSupersededWithoutSupersedor.severity).toBe("error");
  });

  it("only applies to claim-typed pages", () => {
    expect(
      claimSupersededWithoutSupersedor.appliesTo(makePage({ type: "claim" }))
    ).toBe(true);
    expect(
      claimSupersededWithoutSupersedor.appliesTo(makePage({ type: "concept" }))
    ).toBe(false);
    expect(
      claimSupersededWithoutSupersedor.appliesTo(makePage({}))
    ).toBe(false);
  });

  it("errors on superseded claim with null superseded_by", () => {
    const page = makePage({
      type: "claim",
      status: "superseded",
      superseded_by: null,
    });
    const findings = claimSupersededWithoutSupersedor.check(page);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].ruleId).toBe("claim-superseded-without-supersedor");
    expect(findings[0].line).toBe(1);
    expect(findings[0].message).toMatch(/superseded/i);
    expect(findings[0].message).toMatch(/superseded_by/);
  });

  it("errors on superseded claim with omitted superseded_by (treated as null)", () => {
    const page = makePage({ type: "claim", status: "superseded" });
    const findings = claimSupersededWithoutSupersedor.check(page);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
  });

  it("errors on superseded claim with empty-string superseded_by (falsy)", () => {
    // Empty-string is also a structural-integrity violation. ClaimSuperseded
    // schema requires .min(1); lint catches the bypass case.
    const page = makePage({
      type: "claim",
      status: "superseded",
      superseded_by: "",
    });
    const findings = claimSupersededWithoutSupersedor.check(page);
    expect(findings).toHaveLength(1);
  });

  it("does not trigger when superseded claim has a supersedor id", () => {
    const page = makePage({
      type: "claim",
      status: "superseded",
      superseded_by: "claim-foo",
    });
    expect(claimSupersededWithoutSupersedor.check(page)).toHaveLength(0);
  });

  it("does not trigger when active claim has null superseded_by", () => {
    const page = makePage({
      type: "claim",
      status: "active",
      superseded_by: null,
    });
    expect(claimSupersededWithoutSupersedor.check(page)).toHaveLength(0);
  });

  it("does not trigger on draft claims with null superseded_by", () => {
    const page = makePage({
      type: "claim",
      status: "draft",
      superseded_by: null,
    });
    expect(claimSupersededWithoutSupersedor.check(page)).toHaveLength(0);
  });

  it("does not trigger on retracted claims with null superseded_by", () => {
    const page = makePage({
      type: "claim",
      status: "retracted",
      superseded_by: null,
    });
    expect(claimSupersededWithoutSupersedor.check(page)).toHaveLength(0);
  });
});
