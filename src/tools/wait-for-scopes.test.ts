import { describe, it, expect } from "vitest";
import { waitForTool } from "./wait-for.js";
import type { ToolScope } from "../auth/types.js";

describe("vault_wait-for consolidated tool scope axes", () => {
  it("declares a scope field", () => {
    expect(waitForTool).toHaveProperty("scope");
  });

  it("scope conforms to ToolScope shape (axis is a function)", () => {
    const scope = (waitForTool as unknown as { scope: ToolScope }).scope;
    expect(typeof scope.axis).toBe("function");
  });

  describe("mode: next — scope derived from filter", () => {
    it("axis returns the channel when filter.channel is provided", () => {
      const scope = (waitForTool as unknown as { scope: ToolScope }).scope;
      const result = scope.axis({ mode: "next", filter: { source: "vault", channel: "general" } });
      expect(result).toBe("general");
    });

    it("axis returns source when filter.channel is absent", () => {
      const scope = (waitForTool as unknown as { scope: ToolScope }).scope;
      const result = scope.axis({ mode: "next", filter: { source: "vault" } });
      expect(result).toBe("vault");
    });
  });

  describe("mode: many — scope derived from filter", () => {
    it("axis returns the channel when filter.channel is provided", () => {
      const scope = (waitForTool as unknown as { scope: ToolScope }).scope;
      const result = scope.axis({ mode: "many", filter: { source: "vault", channel: "notifications" } });
      expect(result).toBe("notifications");
    });

    it("axis returns source when filter.channel is absent", () => {
      const scope = (waitForTool as unknown as { scope: ToolScope }).scope;
      const result = scope.axis({ mode: "many", filter: { source: "metrics" } });
      expect(result).toBe("metrics");
    });
  });

  describe("mode: any — scope derived from filters[0]", () => {
    it("axis returns channel of first filter when provided", () => {
      const scope = (waitForTool as unknown as { scope: ToolScope }).scope;
      const result = scope.axis({ mode: "any", filters: [{ source: "vault", channel: "alerts" }, { source: "vault" }] });
      expect(result).toBe("alerts");
    });

    it("axis returns source of first filter when channel is absent", () => {
      const scope = (waitForTool as unknown as { scope: ToolScope }).scope;
      const result = scope.axis({ mode: "any", filters: [{ source: "events" }] });
      expect(result).toBe("events");
    });

    it("axis falls back to * for empty filters array", () => {
      const scope = (waitForTool as unknown as { scope: ToolScope }).scope;
      expect(scope.axis({ mode: "any", filters: [] })).toBe("*");
    });
  });

  describe("mode: all — scope derived from filters[0]", () => {
    it("axis returns channel of first filter when provided", () => {
      const scope = (waitForTool as unknown as { scope: ToolScope }).scope;
      const result = scope.axis({ mode: "all", filters: [{ source: "vault", channel: "tasks" }, { source: "vault" }] });
      expect(result).toBe("tasks");
    });

    it("axis returns source of first filter when channel is absent", () => {
      const scope = (waitForTool as unknown as { scope: ToolScope }).scope;
      const result = scope.axis({ mode: "all", filters: [{ source: "logs" }] });
      expect(result).toBe("logs");
    });

    it("axis falls back to * for empty filters array", () => {
      const scope = (waitForTool as unknown as { scope: ToolScope }).scope;
      expect(scope.axis({ mode: "all", filters: [] })).toBe("*");
    });
  });

  describe("fallback to * for null/undefined input", () => {
    it("axis falls back to * for null input", () => {
      const scope = (waitForTool as unknown as { scope: ToolScope }).scope;
      expect(scope.axis(null)).toBe("*");
    });

    it("axis falls back to * for undefined input", () => {
      const scope = (waitForTool as unknown as { scope: ToolScope }).scope;
      expect(scope.axis(undefined)).toBe("*");
    });
  });

  describe("tool name", () => {
    it("has name vault_wait-for", () => {
      expect(waitForTool.name).toBe("vault_wait-for");
    });
  });
});
