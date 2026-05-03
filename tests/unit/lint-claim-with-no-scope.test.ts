// vault-mcp/tests/unit/lint-claim-with-no-scope.test.ts
//
// Unit tests for the `claim-with-no-scope` lint rule (Plan 1 §task-lint-
// no-scope). Covers the four Acceptance criteria bullets plus a couple of
// guard cases (status=draft, status=retracted, multi-dim mixes) so future
// edits to `appliesTo`/`check` don't silently widen the rule.
//
// LintCheck shape under test: `{ id, severity, appliesTo(page), check(page)
// → LintFinding[] }` per the plan template, distinct from the registry-
// based `LintCheck` in core/lint-check.ts. The registration task
// (task-lint-checks-registration) will reconcile the two shapes; this test
// exercises the plan-spec shape directly.

import { describe, it, expect } from "vitest";
import { claimWithNoScope } from "../../src/core/lint-checks/claim-with-no-scope.js";
import { makePage } from "../helpers.js";

describe("claim-with-no-scope lint rule", () => {
  it("declares id and severity per plan", () => {
    expect(claimWithNoScope.id).toBe("claim-with-no-scope");
    expect(claimWithNoScope.severity).toBe("warn");
  });

  // --- appliesTo gating --------------------------------------------------

  it("appliesTo: matches active claim", () => {
    const page = makePage({ type: "claim", status: "active" });
    expect(claimWithNoScope.appliesTo(page)).toBe(true);
  });

  it("appliesTo: skips non-claim type", () => {
    const page = makePage({ type: "concept", status: "active" });
    expect(claimWithNoScope.appliesTo(page)).toBe(false);
  });

  it("appliesTo: skips draft claim", () => {
    const page = makePage({ type: "claim", status: "draft" });
    expect(claimWithNoScope.appliesTo(page)).toBe(false);
  });

  it("appliesTo: skips superseded claim", () => {
    const page = makePage({ type: "claim", status: "superseded" });
    expect(claimWithNoScope.appliesTo(page)).toBe(false);
  });

  it("appliesTo: skips retracted claim", () => {
    const page = makePage({ type: "claim", status: "retracted" });
    expect(claimWithNoScope.appliesTo(page)).toBe(false);
  });

  // --- check() — Acceptance criteria 1–4 --------------------------------

  it("triggers warning when all four scope dimensions are empty (Acceptance #1)", () => {
    const page = makePage({
      type: "claim", status: "active",
      profile: [], move: [], scope_wiki: [], tags: [],
    });
    const findings = claimWithNoScope.check(page);
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe("claim-with-no-scope");
    expect(findings[0].severity).toBe("warn");
    expect(findings[0].line).toBe(1);
    expect(findings[0].message).toMatch(/no scope/i);
    expect(findings[0].message).toMatch(/profile/);
    expect(findings[0].message).toMatch(/move/);
    expect(findings[0].message).toMatch(/scope_wiki/);
    expect(findings[0].message).toMatch(/tags/);
  });

  it("does not trigger when only tags are populated (Acceptance #2)", () => {
    const page = makePage({
      type: "claim", status: "active",
      profile: [], move: [], scope_wiki: [], tags: ["foo"],
    });
    expect(claimWithNoScope.check(page)).toHaveLength(0);
  });

  it("does not trigger when only profile is populated (Acceptance #3)", () => {
    const page = makePage({
      type: "claim", status: "active",
      profile: ["profile-charmander"], move: [], scope_wiki: [], tags: [],
    });
    expect(claimWithNoScope.check(page)).toHaveLength(0);
  });

  it("does not trigger on a superseded claim with all-empty scope (Acceptance #4)", () => {
    // The check() function is the inner test; appliesTo() gates dispatch.
    // We verify both layers: appliesTo says no, AND if anyone bypassed
    // the gate the check would still… well, the plan's reference impl
    // returns a finding. Acceptance #4 reads naturally as "the rule does
    // not produce a warning for superseded claims" — i.e., the *system*
    // does not trigger, which is the appliesTo gate. Verify the gate.
    const page = makePage({
      type: "claim", status: "superseded",
      profile: [], move: [], scope_wiki: [], tags: [],
    });
    expect(claimWithNoScope.appliesTo(page)).toBe(false);
  });

  // --- additional guard cases -------------------------------------------

  it("does not trigger when only move is populated", () => {
    const page = makePage({
      type: "claim", status: "active",
      profile: [], move: ["move-tdd-cycle"], scope_wiki: [], tags: [],
    });
    expect(claimWithNoScope.check(page)).toHaveLength(0);
  });

  it("does not trigger when only scope_wiki is populated", () => {
    const page = makePage({
      type: "claim", status: "active",
      profile: [], move: [], scope_wiki: ["alpha"], tags: [],
    });
    expect(claimWithNoScope.check(page)).toHaveLength(0);
  });

  it("does not trigger when multiple scope dimensions are populated", () => {
    const page = makePage({
      type: "claim", status: "active",
      profile: ["profile-charmander"],
      move: ["move-tdd-cycle"],
      scope_wiki: ["alpha"],
      tags: ["repo:vault-mcp"],
    });
    expect(claimWithNoScope.check(page)).toHaveLength(0);
  });

  it("triggers when scope dimensions are absent (undefined) — coerced empty", () => {
    // Frontmatter may omit empty arrays entirely. The rule should still
    // recognize "no scope" when fields are simply not present.
    const page = makePage({
      type: "claim", status: "active",
      // profile, move, scope_wiki, tags all undefined
    });
    expect(claimWithNoScope.check(page)).toHaveLength(1);
  });

  it("does not trigger when tags is non-empty even if other dims are absent", () => {
    const page = makePage({
      type: "claim", status: "active",
      tags: ["repo:vault-mcp"],
      // profile, move, scope_wiki all undefined
    });
    expect(claimWithNoScope.check(page)).toHaveLength(0);
  });
});
