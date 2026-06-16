import { describe, it, expect } from "vitest";
import { z } from "zod";

describe("wait-for tool exports", () => {
  it("waitForTool has correct name and Zod inputSchema", async () => {
    const { waitForTool } = await import("../../src/tools/wait-for.js");
    expect(waitForTool.name).toBe("vault_wait-for");
    expect(typeof waitForTool.description).toBe("string");
    expect(waitForTool.inputSchema).toBeDefined();
    // Zod schemas have a parse method
    expect(typeof waitForTool.inputSchema.parse).toBe("function");
    // Validate schema defaults
    const parsed = waitForTool.inputSchema.parse({ mode: "next", filter: { source: "journal" } });
    expect(parsed.timeout_ms).toBe(25_000);
    expect(typeof waitForTool.handler).toBe("function");
  });

  it("waitForTool inputSchema rejects timeout_ms > 120000", async () => {
    const { waitForTool } = await import("../../src/tools/wait-for.js");
    expect(() =>
      waitForTool.inputSchema.parse({ mode: "next", filter: { source: "journal" }, timeout_ms: 200_000 })
    ).toThrow();
  });

  it("waitForTool mode=any accepts filters array", async () => {
    const { waitForTool } = await import("../../src/tools/wait-for.js");
    expect(typeof waitForTool.inputSchema.parse).toBe("function");
    const parsed = waitForTool.inputSchema.parse({
      mode: "any",
      filters: [{ source: "journal" }, { source: "task" }],
    });
    expect(parsed.filters).toHaveLength(2);
    expect(parsed.timeout_ms).toBe(25_000);
    expect(typeof waitForTool.handler).toBe("function");
  });

  it("waitForTool mode=any inputSchema rejects empty filters array", async () => {
    const { waitForTool } = await import("../../src/tools/wait-for.js");
    expect(() =>
      waitForTool.inputSchema.parse({ mode: "any", filters: [] })
    ).toThrow();
  });

  it("waitForTool mode=all accepts filters array", async () => {
    const { waitForTool } = await import("../../src/tools/wait-for.js");
    expect(typeof waitForTool.inputSchema.parse).toBe("function");
    const parsed = waitForTool.inputSchema.parse({
      mode: "all",
      filters: [{ source: "journal" }],
    });
    expect(parsed.filters).toHaveLength(1);
    expect(parsed.timeout_ms).toBe(25_000);
    expect(typeof waitForTool.handler).toBe("function");
  });

  it("waitForTool mode=many accepts filter + max", async () => {
    const { waitForTool } = await import("../../src/tools/wait-for.js");
    expect(typeof waitForTool.inputSchema.parse).toBe("function");
    const parsed = waitForTool.inputSchema.parse({
      mode: "many",
      filter: { source: "journal" },
      max: 10,
    });
    expect(parsed.max).toBe(10);
    expect(parsed.timeout_ms).toBe(25_000);
    expect(typeof waitForTool.handler).toBe("function");
  });

  it("waitForTool mode=many inputSchema rejects max > 1000", async () => {
    const { waitForTool } = await import("../../src/tools/wait-for.js");
    expect(() =>
      waitForTool.inputSchema.parse({ mode: "many", filter: { source: "journal" }, max: 1001 })
    ).toThrow();
  });
});

describe("vault_wait-for requireField guard errors", () => {
  it("mode=any without filters throws error matching /requires 'filters'/", async () => {
    const { waitForTool } = await import("../../src/tools/wait-for.js");
    // Parse succeeds (filters is optional in Zod), but handler throws
    const input = waitForTool.inputSchema.parse({ mode: "any" });
    const fakeCtx = { vaultPath: "/tmp", bus: {} as never, registry: {} as never, watcher: {} as never };
    await expect(waitForTool.handler(input, fakeCtx)).rejects.toThrow(/requires 'filters'/);
  });

  it("mode=all without filters throws error matching /requires 'filters'/", async () => {
    const { waitForTool } = await import("../../src/tools/wait-for.js");
    const input = waitForTool.inputSchema.parse({ mode: "all" });
    const fakeCtx = { vaultPath: "/tmp", bus: {} as never, registry: {} as never, watcher: {} as never };
    await expect(waitForTool.handler(input, fakeCtx)).rejects.toThrow(/requires 'filters'/);
  });

  it("mode=next without filter throws error matching /requires 'filter'/", async () => {
    const { waitForTool } = await import("../../src/tools/wait-for.js");
    const input = waitForTool.inputSchema.parse({ mode: "next" });
    const fakeCtx = { vaultPath: "/tmp", bus: {} as never, registry: {} as never, watcher: {} as never };
    await expect(waitForTool.handler(input, fakeCtx)).rejects.toThrow(/requires 'filter'/);
  });

  it("mode=many without filter throws error matching /requires 'filter'/", async () => {
    const { waitForTool } = await import("../../src/tools/wait-for.js");
    const input = waitForTool.inputSchema.parse({ mode: "many", max: 5 });
    const fakeCtx = { vaultPath: "/tmp", bus: {} as never, registry: {} as never, watcher: {} as never };
    await expect(waitForTool.handler(input, fakeCtx)).rejects.toThrow(/requires 'filter'/);
  });

  it("mode=many without max throws error matching /requires 'max'/", async () => {
    const { waitForTool } = await import("../../src/tools/wait-for.js");
    const input = waitForTool.inputSchema.parse({ mode: "many", filter: { source: "journal" } });
    const fakeCtx = { vaultPath: "/tmp", bus: {} as never, registry: {} as never, watcher: {} as never };
    await expect(waitForTool.handler(input, fakeCtx)).rejects.toThrow(/requires 'max'/);
  });
});
