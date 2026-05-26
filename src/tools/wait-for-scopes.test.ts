import { describe, it, expect } from "vitest";
import { waitForTool } from "./wait-for.js";
import { waitForAnyTool } from "./wait-for-any.js";
import { waitForAllTool } from "./wait-for-all.js";
import { waitForManyTool } from "./wait-for-many.js";
import type { ToolScope } from "../auth/types.js";

describe("wait-for tool scope axes", () => {
  describe("waitForTool scope", () => {
    it("declares a scope field", () => {
      expect(waitForTool).toHaveProperty("scope");
    });

    it("scope conforms to ToolScope shape (axis is a function)", () => {
      const scope = (waitForTool as unknown as { scope: ToolScope }).scope;
      expect(typeof scope.axis).toBe("function");
    });

    it("axis returns the channel when filter.channel is provided", () => {
      const scope = (waitForTool as unknown as { scope: ToolScope }).scope;
      const result = scope.axis({ filter: { source: "vault", channel: "general" } });
      expect(result).toBe("general");
    });

    it("axis returns source when filter.channel is absent", () => {
      const scope = (waitForTool as unknown as { scope: ToolScope }).scope;
      const result = scope.axis({ filter: { source: "vault" } });
      expect(result).toBe("vault");
    });

    it("axis falls back to * for null/undefined input", () => {
      const scope = (waitForTool as unknown as { scope: ToolScope }).scope;
      expect(scope.axis(null)).toBe("*");
      expect(scope.axis(undefined)).toBe("*");
    });
  });

  describe("waitForAnyTool scope", () => {
    it("declares a scope field", () => {
      expect(waitForAnyTool).toHaveProperty("scope");
    });

    it("scope conforms to ToolScope shape (axis is a function)", () => {
      const scope = (waitForAnyTool as unknown as { scope: ToolScope }).scope;
      expect(typeof scope.axis).toBe("function");
    });

    it("axis returns channel of first filter when provided", () => {
      const scope = (waitForAnyTool as unknown as { scope: ToolScope }).scope;
      const result = scope.axis({ filters: [{ source: "vault", channel: "alerts" }, { source: "vault" }] });
      expect(result).toBe("alerts");
    });

    it("axis returns source of first filter when channel is absent", () => {
      const scope = (waitForAnyTool as unknown as { scope: ToolScope }).scope;
      const result = scope.axis({ filters: [{ source: "events" }] });
      expect(result).toBe("events");
    });

    it("axis falls back to * for empty filters array", () => {
      const scope = (waitForAnyTool as unknown as { scope: ToolScope }).scope;
      expect(scope.axis({ filters: [] })).toBe("*");
    });

    it("axis falls back to * for null/undefined input", () => {
      const scope = (waitForAnyTool as unknown as { scope: ToolScope }).scope;
      expect(scope.axis(null)).toBe("*");
      expect(scope.axis(undefined)).toBe("*");
    });
  });

  describe("waitForAllTool scope", () => {
    it("declares a scope field", () => {
      expect(waitForAllTool).toHaveProperty("scope");
    });

    it("scope conforms to ToolScope shape (axis is a function)", () => {
      const scope = (waitForAllTool as unknown as { scope: ToolScope }).scope;
      expect(typeof scope.axis).toBe("function");
    });

    it("axis returns channel of first filter when provided", () => {
      const scope = (waitForAllTool as unknown as { scope: ToolScope }).scope;
      const result = scope.axis({ filters: [{ source: "vault", channel: "tasks" }, { source: "vault" }] });
      expect(result).toBe("tasks");
    });

    it("axis returns source of first filter when channel is absent", () => {
      const scope = (waitForAllTool as unknown as { scope: ToolScope }).scope;
      const result = scope.axis({ filters: [{ source: "logs" }] });
      expect(result).toBe("logs");
    });

    it("axis falls back to * for empty filters array", () => {
      const scope = (waitForAllTool as unknown as { scope: ToolScope }).scope;
      expect(scope.axis({ filters: [] })).toBe("*");
    });

    it("axis falls back to * for null/undefined input", () => {
      const scope = (waitForAllTool as unknown as { scope: ToolScope }).scope;
      expect(scope.axis(null)).toBe("*");
      expect(scope.axis(undefined)).toBe("*");
    });
  });

  describe("waitForManyTool scope", () => {
    it("declares a scope field", () => {
      expect(waitForManyTool).toHaveProperty("scope");
    });

    it("scope conforms to ToolScope shape (axis is a function)", () => {
      const scope = (waitForManyTool as unknown as { scope: ToolScope }).scope;
      expect(typeof scope.axis).toBe("function");
    });

    it("axis returns the channel when filter.channel is provided", () => {
      const scope = (waitForManyTool as unknown as { scope: ToolScope }).scope;
      const result = scope.axis({ filter: { source: "vault", channel: "notifications" } });
      expect(result).toBe("notifications");
    });

    it("axis returns source when filter.channel is absent", () => {
      const scope = (waitForManyTool as unknown as { scope: ToolScope }).scope;
      const result = scope.axis({ filter: { source: "metrics" } });
      expect(result).toBe("metrics");
    });

    it("axis falls back to * for null/undefined input", () => {
      const scope = (waitForManyTool as unknown as { scope: ToolScope }).scope;
      expect(scope.axis(null)).toBe("*");
      expect(scope.axis(undefined)).toBe("*");
    });
  });
});
