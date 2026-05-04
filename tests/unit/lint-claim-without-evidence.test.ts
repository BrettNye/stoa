import { describe, it, expect } from "vitest";
import { claimWithoutEvidence } from "../../src/core/lint-checks/claim-without-evidence.js";
import { makePage } from "../helpers.js";

describe("claim-without-evidence lint rule", () => {
  describe("appliesTo", () => {
    it("applies to claim pages", () => {
      const page = makePage({ id: "claim-x", type: "claim", status: "active", evidence: [] });
      expect(claimWithoutEvidence.appliesTo(page)).toBe(true);
    });

    it("does not apply to non-claim pages", () => {
      const page = makePage({ id: "concept-x", type: "concept" });
      expect(claimWithoutEvidence.appliesTo(page)).toBe(false);
    });

    it("does not apply when frontmatter is absent", () => {
      const page = { frontmatter: undefined as unknown as Record<string, unknown>, content: "" };
      expect(claimWithoutEvidence.appliesTo(page as never)).toBe(false);
    });
  });

  describe("check — acceptance criteria", () => {
    it("triggers a single warning when an active claim has empty evidence", () => {
      const page = makePage({
        id: "claim-foo",
        type: "claim",
        status: "active",
        evidence: [],
      });
      const findings = claimWithoutEvidence.check(page);
      expect(findings).toHaveLength(1);
      expect(findings[0].ruleId).toBe("claim-without-evidence");
      expect(findings[0].severity).toBe("warn");
      expect(findings[0].message).toMatch(/evidence/i);
    });

    it("does NOT trigger when an active claim has populated evidence", () => {
      const page = makePage({
        id: "claim-foo",
        type: "claim",
        status: "active",
        evidence: ["[[wikis/_agents/journal/journal-foo]]"],
      });
      expect(claimWithoutEvidence.check(page)).toHaveLength(0);
    });

    it("does NOT trigger on a superseded claim with empty evidence", () => {
      const page = makePage({
        id: "claim-old",
        type: "claim",
        status: "superseded",
        superseded_by: "claim-new",
        evidence: [],
      });
      expect(claimWithoutEvidence.check(page)).toHaveLength(0);
    });

    it("does NOT trigger on a draft claim with empty evidence", () => {
      const page = makePage({
        id: "claim-wip",
        type: "claim",
        status: "draft",
        evidence: [],
      });
      expect(claimWithoutEvidence.check(page)).toHaveLength(0);
    });

    it("does NOT trigger on a retracted claim with empty evidence", () => {
      const page = makePage({
        id: "claim-retracted",
        type: "claim",
        status: "retracted",
        evidence: [],
      });
      expect(claimWithoutEvidence.check(page)).toHaveLength(0);
    });
  });

  describe("check — edge cases", () => {
    it("treats missing evidence field as empty (active → triggers)", () => {
      const page = makePage({
        id: "claim-no-evidence-key",
        type: "claim",
        status: "active",
      });
      expect(claimWithoutEvidence.check(page)).toHaveLength(1);
    });

    it("does not trigger when evidence has multiple entries", () => {
      const page = makePage({
        id: "claim-multi",
        type: "claim",
        status: "active",
        evidence: [
          "[[wikis/_agents/journal/journal-a]]",
          "[[wikis/_agents/journal/journal-b]]",
        ],
      });
      expect(claimWithoutEvidence.check(page)).toHaveLength(0);
    });
  });

  describe("rule metadata", () => {
    it("has rule id 'claim-without-evidence'", () => {
      expect(claimWithoutEvidence.id).toBe("claim-without-evidence");
    });

    it("has severity 'warn'", () => {
      expect(claimWithoutEvidence.severity).toBe("warn");
    });
  });
});
