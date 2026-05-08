import { describe, it, expect } from "vitest";
import { z } from "zod";

describe("wait-for tool exports", () => {
  it("waitForTool has correct name and Zod inputSchema", async () => {
    const { waitForTool } = await import("../../src/tools/wait-for.js");
    expect(waitForTool.name).toBe("vault.wait-for");
    expect(typeof waitForTool.description).toBe("string");
    expect(waitForTool.inputSchema).toBeDefined();
    // Zod schemas have a parse method
    expect(typeof waitForTool.inputSchema.parse).toBe("function");
    // Validate schema defaults
    const parsed = waitForTool.inputSchema.parse({ filter: { source: "journal" } });
    expect(parsed.timeout_ms).toBe(25_000);
    expect(typeof waitForTool.handler).toBe("function");
  });

  it("waitForTool inputSchema rejects timeout_ms > 120000", async () => {
    const { waitForTool } = await import("../../src/tools/wait-for.js");
    expect(() =>
      waitForTool.inputSchema.parse({ filter: { source: "journal" }, timeout_ms: 200_000 })
    ).toThrow();
  });

  it("waitForAnyTool has correct name and accepts filters array", async () => {
    const { waitForAnyTool } = await import("../../src/tools/wait-for-any.js");
    expect(waitForAnyTool.name).toBe("vault.wait-for-any");
    expect(typeof waitForAnyTool.description).toBe("string");
    expect(typeof waitForAnyTool.inputSchema.parse).toBe("function");
    const parsed = waitForAnyTool.inputSchema.parse({
      filters: [{ source: "journal" }, { source: "task" }],
    });
    expect(parsed.filters).toHaveLength(2);
    expect(parsed.timeout_ms).toBe(25_000);
    expect(typeof waitForAnyTool.handler).toBe("function");
  });

  it("waitForAnyTool inputSchema rejects empty filters array", async () => {
    const { waitForAnyTool } = await import("../../src/tools/wait-for-any.js");
    expect(() =>
      waitForAnyTool.inputSchema.parse({ filters: [] })
    ).toThrow();
  });

  it("waitForAllTool has correct name and accepts filters array", async () => {
    const { waitForAllTool } = await import("../../src/tools/wait-for-all.js");
    expect(waitForAllTool.name).toBe("vault.wait-for-all");
    expect(typeof waitForAllTool.description).toBe("string");
    expect(typeof waitForAllTool.inputSchema.parse).toBe("function");
    const parsed = waitForAllTool.inputSchema.parse({
      filters: [{ source: "journal" }],
    });
    expect(parsed.filters).toHaveLength(1);
    expect(parsed.timeout_ms).toBe(25_000);
    expect(typeof waitForAllTool.handler).toBe("function");
  });

  it("waitForManyTool has correct name and accepts filter + max", async () => {
    const { waitForManyTool } = await import("../../src/tools/wait-for-many.js");
    expect(waitForManyTool.name).toBe("vault.wait-for-many");
    expect(typeof waitForManyTool.description).toBe("string");
    expect(typeof waitForManyTool.inputSchema.parse).toBe("function");
    const parsed = waitForManyTool.inputSchema.parse({
      filter: { source: "journal" },
      max: 10,
    });
    expect(parsed.max).toBe(10);
    expect(parsed.timeout_ms).toBe(25_000);
    expect(typeof waitForManyTool.handler).toBe("function");
  });

  it("waitForManyTool inputSchema rejects max > 1000", async () => {
    const { waitForManyTool } = await import("../../src/tools/wait-for-many.js");
    expect(() =>
      waitForManyTool.inputSchema.parse({ filter: { source: "journal" }, max: 1001 })
    ).toThrow();
  });
});
