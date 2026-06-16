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

describe("allTools — consolidated tool surface (55 → 43)", () => {
  const names = allTools.map((t) => t.name);

  const CONSOLIDATED = [
    "vault_wait-for",
    "vault_trainer-submit",
    "vault_merge",
    "vault_stadium-list",
    "vault_task",
    "vault_channel",
    "vault_real-skill",
    "vault_sync",
  ];

  for (const n of CONSOLIDATED) {
    it(`registers ${n}`, () => expect(names).toContain(n));
  }

  const OLD = [
    "vault_wait-for-any",
    "vault_wait-for-all",
    "vault_wait-for-many",
    "vault_trainer-submit-draft",
    "vault_trainer-submit-move",
    "vault_merge-queue",
    "vault_merge-record",
    "vault_list-invites",
    "vault_list-platform-profiles",
    "vault_task-create",
    "vault_task-list",
    "vault_task-update",
    "vault_task-claim",
    "vault_channel-post",
    "vault_channel-tail",
    "vault_real-skill-register",
    "vault_real-skill-refresh",
    "vault_sync-skills",
    "vault_sync-agents",
  ];

  it("retires all old names", () => OLD.forEach((n) => expect(names).not.toContain(n)));

  it("advertises 43 tools", () => expect(allTools.length).toBe(43));
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
