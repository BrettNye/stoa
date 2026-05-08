// Integration test for task-tools-registration:
// 1. allTools includes all four wait-for tool names (v1.7.1 push primitives).
// 2. buildCtx (with eventBundle) returns an object with bus/registry/watcher fields populated.

import { describe, it, expect } from "vitest";
import { allTools } from "../../src/tools/index.js";
import { buildCtx } from "../../src/transport/stdio.js";
import { EventBus } from "../../src/core/eventbus/bus.js";
import { WaiterRegistry } from "../../src/core/eventbus/registry.js";
import { Watcher } from "../../src/core/eventbus/watcher.js";
import { getAllGlobs } from "../../src/core/eventbus/matchers/index.js";

describe("allTools — v1.7.1 wait-for tools registered", () => {
  const names = allTools.map((t) => t.name);

  it("includes vault.wait-for", () => {
    expect(names).toContain("vault.wait-for");
  });

  it("includes vault.wait-for-any", () => {
    expect(names).toContain("vault.wait-for-any");
  });

  it("includes vault.wait-for-all", () => {
    expect(names).toContain("vault.wait-for-all");
  });

  it("includes vault.wait-for-many", () => {
    expect(names).toContain("vault.wait-for-many");
  });
});

describe("buildCtx — eventBundle fields threaded through (v1.7.1)", () => {
  const vaultPath = "/tmp/test-vault";

  it("returns bus/registry/watcher when eventBundle provided", () => {
    const bus = new EventBus();
    const watcher = new Watcher({ vaultPath, globs: getAllGlobs(), onEvent: () => {} });
    const registry = new WaiterRegistry(bus);

    const ctx = buildCtx({ vaultPath, mcpMode: true }, { bus, registry, watcher });

    expect(ctx.bus).toBe(bus);
    expect(ctx.registry).toBe(registry);
    expect(ctx.watcher).toBe(watcher);
    expect(ctx.vaultPath).toBe(vaultPath);

    // Cleanup
    registry.close();
    watcher.close().catch(() => {});
  });

  it("leaves bus/registry/watcher undefined when no eventBundle provided (backward compat)", () => {
    const ctx = buildCtx({ vaultPath, mcpMode: true });

    expect(ctx.bus).toBeUndefined();
    expect(ctx.registry).toBeUndefined();
    expect(ctx.watcher).toBeUndefined();
  });

  it("still populates vaultPath, fetcher, defaultWiki, defaultFamily when eventBundle absent", () => {
    const ctx = buildCtx({
      vaultPath,
      mcpMode: true,
      defaultWiki: "alpha",
      defaultFamily: "rastate",
    });

    expect(ctx.vaultPath).toBe(vaultPath);
    expect(typeof ctx.fetcher).toBe("function");
    expect(ctx.defaultWiki).toBe("alpha");
    expect(ctx.defaultFamily).toBe("rastate");
  });
});
