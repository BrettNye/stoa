import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lintTool } from "../../src/tools/lint.js";
import {
  lintCheckRegistry,
  registerLintCheck,
  type LintCheck,
  type LintCheckCtx,
} from "../../src/core/lint-check.js";

// v1.6 Phase 2 T3-6 — `tools/lint.ts` constructs `LintCheckCtx` from the
// dispatch ctx and must propagate `defaultFamily` so future lint checks
// (Plan C; v1.7) can scope by family. The Phase 2 lint check
// `family-member-mode-drift` does NOT read it (it scans every wiki and
// groups by family field), so this test is forward-compat coverage.

let vault: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-lint-df-"));
  // Minimal vault skeleton so loadIndex + lint() don't blow up.
  mkdirSync(join(vault, "_index"), { recursive: true });
  mkdirSync(join(vault, "wikis", "_agents"), { recursive: true });
  writeFileSync(
    join(vault, "wikis", "_agents", "map.md"),
    `---
id: map-_agents
title: agents
type: map
wiki: _agents
status: active
created: 2026-04-30
updated: 2026-04-30
summary: m
---
`
  );
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

describe("lintTool propagates defaultFamily into LintCheckCtx (T3-6)", () => {
  it("registered checks observe ctx.defaultFamily when dispatch ctx carries it", async () => {
    // Register an ephemeral capture-check that records the ctx it was handed.
    const captured: LintCheckCtx[] = [];
    const probe: LintCheck = {
      code: "TEST_CAPTURE_DEFAULT_FAMILY",
      run(ctx) {
        captured.push({ ...ctx });
        return [];
      },
    };
    registerLintCheck(probe);
    try {
      await lintTool.handler(
        { level: "info" as const },
        {
          vaultPath: vault,
          defaultWiki: "rastate-core",
          defaultFamily: "rastate",
        }
      );
      expect(captured.length).toBeGreaterThan(0);
      const last = captured[captured.length - 1];
      expect(last.vaultPath).toBe(vault);
      expect(last.defaultWiki).toBe("rastate-core");
      expect(last.defaultFamily).toBe("rastate");
    } finally {
      // De-register the probe so we don't pollute other tests.
      const idx = lintCheckRegistry.indexOf(probe);
      if (idx >= 0) lintCheckRegistry.splice(idx, 1);
    }
  });

  it("ctx.defaultFamily remains undefined when dispatch ctx omits it", async () => {
    const captured: LintCheckCtx[] = [];
    const probe: LintCheck = {
      code: "TEST_CAPTURE_DEFAULT_FAMILY_UNSET",
      run(ctx) {
        captured.push({ ...ctx });
        return [];
      },
    };
    registerLintCheck(probe);
    try {
      await lintTool.handler(
        { level: "info" as const },
        { vaultPath: vault }
      );
      expect(captured.length).toBeGreaterThan(0);
      expect(captured[captured.length - 1].defaultFamily).toBeUndefined();
    } finally {
      const idx = lintCheckRegistry.indexOf(probe);
      if (idx >= 0) lintCheckRegistry.splice(idx, 1);
    }
  });
});
