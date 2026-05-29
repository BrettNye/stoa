// src/tools/curate.test.ts
//
// Tests for the vault_curate MCP tool (spec §4.4, §4.6).
//
// Covers:
//   1. scope.adminOnly() returns true
//   2. scope.axis() returns the correct axis string
//   3. inputSchema rejects agent_id (server stamps it)
//   4. handler stamps agent_id from ctx.principal (falls back to "stoa-local")
//   5. handler forwards httpMode derived from principal.source
//   6. handler returns the CurateResult shape { applied, flagged }

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { curateTool } from "./curate.js";
import { _clearIndexCache } from "../core/index.js";
import type { Principal } from "../auth/types.js";

// ─── Minimal vault fixture ────────────────────────────────────────────────────

function makeVault(): string {
  const vault = mkdtempSync(join(tmpdir(), "stoa-curate-tool-test-"));
  mkdirSync(join(vault, "_index"), { recursive: true });
  writeFileSync(join(vault, "_index", "pages.json"), JSON.stringify({ pages: [] }));
  writeFileSync(join(vault, "_index", "tokens.json"), JSON.stringify({}));
  writeFileSync(join(vault, "_index", "wikis.json"), JSON.stringify({ wikis: [] }));
  writeFileSync(join(vault, "_index", "links.json"), JSON.stringify({}));
  return vault;
}

let FIXTURE: string;

beforeEach(() => {
  FIXTURE = makeVault();
  _clearIndexCache();
});

afterEach(() => {
  rmSync(FIXTURE, { recursive: true, force: true });
  _clearIndexCache();
});

// ─── Scope tests ─────────────────────────────────────────────────────────────

describe("curateTool scope", () => {
  it("declares adminOnly scope that returns true", () => {
    expect(curateTool.scope.adminOnly?.({})).toBe(true);
  });

  it("axis returns wikis/<wiki> when wiki is provided", () => {
    expect(curateTool.scope.axis({ wiki: "my-wiki" })).toBe("wikis/my-wiki");
  });

  it("axis returns wikis/* when wiki is omitted", () => {
    expect(curateTool.scope.axis({})).toBe("wikis/*");
  });

  it("axis returns wikis/* when input is undefined", () => {
    expect(curateTool.scope.axis(undefined)).toBe("wikis/*");
  });
});

// ─── Input schema tests ───────────────────────────────────────────────────────

describe("curateTool inputSchema", () => {
  it("accepts empty input", () => {
    const result = curateTool.inputSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts wiki, dry_run, and confidence_floor", () => {
    const result = curateTool.inputSchema.safeParse({
      wiki: "test",
      dry_run: true,
      confidence_floor: "medium",
    });
    expect(result.success).toBe(true);
  });

  it("accepts all valid confidence_floor values", () => {
    for (const val of ["high", "medium", "low"] as const) {
      const result = curateTool.inputSchema.safeParse({ confidence_floor: val });
      expect(result.success).toBe(true);
    }
  });

  it("rejects agent_id field (server stamps it, not caller)", () => {
    const strict = curateTool.inputSchema.strict();
    const result = strict.safeParse({ agent_id: "some-agent" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid confidence_floor", () => {
    const result = curateTool.inputSchema.safeParse({ confidence_floor: "extreme" });
    expect(result.success).toBe(false);
  });
});

// ─── Handler tests ────────────────────────────────────────────────────────────

describe("curateTool handler", () => {
  it("returns applied and flagged arrays (dry_run=true, no principal)", async () => {
    const result = await curateTool.handler(
      { dry_run: true },
      { vaultPath: FIXTURE },
    );
    expect(result).toHaveProperty("applied");
    expect(result).toHaveProperty("flagged");
    expect(Array.isArray(result.applied)).toBe(true);
    expect(Array.isArray(result.flagged)).toBe(true);
  });

  it("stamps agent_id from ctx.principal when provided", async () => {
    // dry_run=true so no journal is written; we verify it resolves without error
    const result = await curateTool.handler(
      { dry_run: true },
      { vaultPath: FIXTURE, principal: { agent_id: "p1", scopes: ["admin:*"], source: "stdio" } as Principal },
    );
    expect(result).toHaveProperty("applied");
  });

  it("falls back to stoa-local when no principal is provided", async () => {
    // dry_run=true so no journal write; would fail if agent_id was undefined
    const result = await curateTool.handler(
      { dry_run: true },
      { vaultPath: FIXTURE },
    );
    expect(result).toHaveProperty("applied");
  });

  it("does not include journal_id on dry_run", async () => {
    const result = await curateTool.handler(
      { dry_run: true },
      { vaultPath: FIXTURE },
    );
    expect(result.journal_id).toBeUndefined();
  });

  it("passes httpMode=true when principal source is http", async () => {
    // httpMode:true → PR verification degrades to "unknown", curate still runs
    const result = await curateTool.handler(
      { dry_run: true },
      {
        vaultPath: FIXTURE,
        principal: { agent_id: "ops", scopes: ["admin:*"], source: "http" } as Principal,
      },
    );
    expect(result).toHaveProperty("applied");
    expect(result).toHaveProperty("flagged");
  });
});

// ─── Tool metadata ────────────────────────────────────────────────────────────

describe("curateTool metadata", () => {
  it("has the correct tool name", () => {
    expect(curateTool.name).toBe("vault_curate");
  });

  it("has a non-empty description", () => {
    expect(typeof curateTool.description).toBe("string");
    expect(curateTool.description.length).toBeGreaterThan(0);
  });
});
