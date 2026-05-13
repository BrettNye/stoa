import { describe, it, expect } from "vitest";
import { taskNotReady } from "../../src/core/lint-checks/task-not-ready.js";
import { makePage } from "../helpers.js";

const fm = (overrides: object) => ({ type: "task", status: "pending", ...overrides });

describe("task-not-ready lint rule", () => {
  describe("rule metadata", () => {
    it("has rule id 'task-not-ready'", () => {
      expect(taskNotReady.id).toBe("task-not-ready");
    });

    it("has severity 'warn'", () => {
      expect(taskNotReady.severity).toBe("warn");
    });
  });

  describe("appliesTo", () => {
    it("applies to pending task pages", () => {
      const page = makePage(fm({}));
      expect(taskNotReady.appliesTo(page)).toBe(true);
    });

    it("does not apply to non-task pages", () => {
      const page = makePage({ type: "concept", status: "pending" });
      expect(taskNotReady.appliesTo(page)).toBe(false);
    });

    it("does not apply to task pages with status other than pending (completed)", () => {
      const page = makePage({ type: "task", status: "completed" });
      expect(taskNotReady.appliesTo(page)).toBe(false);
    });

    it("does not apply to task pages with status active", () => {
      const page = makePage({ type: "task", status: "active" });
      expect(taskNotReady.appliesTo(page)).toBe(false);
    });

    it("does not apply when frontmatter is absent", () => {
      const page = { frontmatter: undefined as unknown as Record<string, unknown>, content: "" };
      expect(taskNotReady.appliesTo(page as never)).toBe(false);
    });
  });

  describe("check — acceptance criteria (four fixture tasks)", () => {
    it("fires zero diagnostics on a fully groomed pending task", () => {
      const body = [
        "Modifies `src/foo.ts:1`.",
        "**Scope:** do the thing.",
        "**Out of scope:** cleanup unrelated to this task.",
        "**Acceptance:** all tests pass.",
      ].join("\n\n");
      const page = makePage(fm({}));
      const pageWithContent = { ...page, content: body };
      expect(taskNotReady.check(pageWithContent)).toHaveLength(0);
    });

    it("fires one consolidated diagnostic for a task missing one signal", () => {
      // Missing out_of_scope only
      const body = [
        "Modifies `src/foo.ts:1`.",
        "**Scope:** do the thing.",
        "**Acceptance:** all tests pass.",
      ].join("\n\n");
      const page = makePage(fm({}));
      const pageWithContent = { ...page, content: body };
      const findings = taskNotReady.check(pageWithContent);
      expect(findings).toHaveLength(1);
      expect(findings[0].ruleId).toBe("task-not-ready");
      expect(findings[0].severity).toBe("warn");
      expect(findings[0].message).toMatch(/out_of_scope/);
    });

    it("fires one consolidated diagnostic listing all missing signals when task body is bare", () => {
      const page = makePage(fm({}));
      const pageWithContent = { ...page, content: "bare body" };
      const findings = taskNotReady.check(pageWithContent);
      expect(findings).toHaveLength(1);
      expect(findings[0].message).toMatch(/files/);
      expect(findings[0].message).toMatch(/scope/);
      expect(findings[0].message).toMatch(/out_of_scope/);
      expect(findings[0].message).toMatch(/verification/);
    });

    it("fires zero diagnostics for a completed task regardless of body (appliesTo gates it)", () => {
      const page = makePage({ type: "task", status: "completed" });
      const pageWithContent = { ...page, content: "bare body" };
      // appliesTo returns false for completed; check should not be called in practice,
      // but calling it directly should still return empty since rule only applies via appliesTo
      // We verify via appliesTo here:
      expect(taskNotReady.appliesTo(pageWithContent)).toBe(false);
    });
  });

  describe("check — message format", () => {
    it("message includes claim-will-be-blocked language", () => {
      const page = makePage(fm({}));
      const pageWithContent = { ...page, content: "bare body" };
      const findings = taskNotReady.check(pageWithContent);
      expect(findings[0].message).toMatch(/claim will be blocked|claim.*blocked/i);
    });

    it("returns finding with line: 1", () => {
      const page = makePage(fm({}));
      const pageWithContent = { ...page, content: "bare body" };
      const findings = taskNotReady.check(pageWithContent);
      expect(findings[0].line).toBe(1);
    });
  });
});
