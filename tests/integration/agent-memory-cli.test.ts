// tests/integration/agent-memory-cli.test.ts
//
// Integration tests for the CLI `agent-memory` command.
//
// Pattern: construct a Commander instance directly and call registerAgentMemory,
// inject a temp vault context via setCtx(), spy on console.log.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Command } from "commander";
import { registerAgentMemory } from "../../src/cli/commands/agent-memory.js";
import { setCtx } from "../../src/cli/_ctx.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers to build a minimal vault with claims
// ─────────────────────────────────────────────────────────────────────────────

function writeClaimPage(
  vaultPath: string,
  wiki: string,
  id: string,
  overrides: Record<string, unknown> = {},
): void {
  const defaults = {
    id,
    key: `tdd.${id}`,
    title: `Claim ${id}`,
    type: "claim",
    status: "active",
    confidence: 0.8,
    last_validated: "2026-05-10",
    authored_by: "agent:charmander",
    profile: ["charmander"],
    scope_wiki: [],
    tags: ["tdd", "testing"],
    summary: `Summary of ${id}`,
    created: "2026-05-01",
    updated: "2026-05-10",
  };
  const merged = { ...defaults, ...overrides };

  const fm = [
    "---",
    ...Object.entries(merged).map(([k, v]) => {
      if (Array.isArray(v)) {
        if (v.length === 0) return `${k}: []`;
        return `${k}:\n${v.map((x: unknown) => `  - ${String(x)}`).join("\n")}`;
      }
      return `${k}: ${String(v)}`;
    }),
    "---",
  ].join("\n");
  const body = `This is the body of claim ${id}.`;
  const claimDir = join(vaultPath, "wikis", wiki, "claim");
  mkdirSync(claimDir, { recursive: true });
  writeFileSync(join(claimDir, `${id}.md`), `${fm}\n${body}`, "utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("CLI agent-memory", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-agent-mem-cli-"));
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    setCtx({ vaultPath, mcpMode: false, defaultWiki: "alpha" });
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("CLI emits JSON when --json is passed", async () => {
    writeClaimPage(vaultPath, "alpha", "claim-001");

    const p = new Command();
    p.exitOverride();
    registerAgentMemory(p);

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.map(String).join(" "));
    });

    await p.parseAsync(["node", "cli", "agent-memory", "charmander", "--json"]);

    const parsed = JSON.parse(logs.join("\n"));
    expect(parsed).toHaveProperty("agent_id", "charmander");
    expect(parsed).toHaveProperty("claims");
    expect(parsed).toHaveProperty("scope_used");
    expect(parsed).toHaveProperty("total_pool_size");
    expect(parsed).toHaveProperty("truncated");
  });

  it("CLI emits markdown by default", async () => {
    writeClaimPage(vaultPath, "alpha", "claim-002");

    const p = new Command();
    p.exitOverride();
    registerAgentMemory(p);

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.map(String).join(" "));
    });

    await p.parseAsync(["node", "cli", "agent-memory", "charmander"]);

    const output = logs.join("\n");
    // Must not be JSON
    expect(() => JSON.parse(output)).toThrow();
    // Should reference the agent id
    expect(output).toContain("charmander");
    // Should contain markdown-ish structure (heading or list)
    expect(output).toMatch(/#+|##/);
  });

  it("CLI emits 'No relevant memory' message when memory is empty", async () => {
    // No claims written — agent "nobody" has no claims at all
    const p = new Command();
    p.exitOverride();
    registerAgentMemory(p);

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.map(String).join(" "));
    });

    await p.parseAsync(["node", "cli", "agent-memory", "nobody"]);

    const output = logs.join("\n");
    expect(output).toContain("No relevant memory");
    expect(output).toContain("nobody");
  });

  it("CLI emits JSON with empty claims array when memory is empty and --json is passed", async () => {
    const p = new Command();
    p.exitOverride();
    registerAgentMemory(p);

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.map(String).join(" "));
    });

    await p.parseAsync(["node", "cli", "agent-memory", "nobody", "--json"]);

    const parsed = JSON.parse(logs.join("\n"));
    expect(parsed).toHaveProperty("agent_id", "nobody");
    expect(parsed.claims).toHaveLength(0);
  });

  it("markdown output includes id, summary, effective_confidence, and score columns", async () => {
    writeClaimPage(vaultPath, "alpha", "claim-003");

    const p = new Command();
    p.exitOverride();
    registerAgentMemory(p);

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.map(String).join(" "));
    });

    await p.parseAsync(["node", "cli", "agent-memory", "charmander"]);

    const output = logs.join("\n");
    // Must show the claim id
    expect(output).toContain("claim-003");
    // Must show score-related info (confidence or score)
    expect(output).toMatch(/score|confidence/i);
  });

  it("passes --limit to the core function", async () => {
    // Write 3 claims
    for (let i = 0; i < 3; i++) {
      writeClaimPage(vaultPath, "alpha", `claim-lim-${i}`);
    }

    const p = new Command();
    p.exitOverride();
    registerAgentMemory(p);

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.map(String).join(" "));
    });

    await p.parseAsync(["node", "cli", "agent-memory", "charmander", "--json", "--limit", "2"]);

    const parsed = JSON.parse(logs.join("\n"));
    expect(parsed.claims.length).toBeLessThanOrEqual(2);
  });

  it("passes --tags flag to the core function (JSON output)", async () => {
    const p = new Command();
    p.exitOverride();
    registerAgentMemory(p);

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.map(String).join(" "));
    });

    await p.parseAsync(["node", "cli", "agent-memory", "charmander", "--json", "--tags", "tdd,testing"]);

    const parsed = JSON.parse(logs.join("\n"));
    expect(parsed).toHaveProperty("agent_id", "charmander");
    // scope_used should reflect the tags
    expect(parsed.scope_used.tags).toContain("tdd");
  });

  it("passes --scope-wiki flag to the core function (JSON output)", async () => {
    const p = new Command();
    p.exitOverride();
    registerAgentMemory(p);

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.map(String).join(" "));
    });

    await p.parseAsync(["node", "cli", "agent-memory", "charmander", "--json", "--scope-wiki", "alpha,beta"]);

    const parsed = JSON.parse(logs.join("\n"));
    expect(parsed.scope_used.scope_wiki).toContain("alpha");
  });

  it("markdown output includes scope_used summary", async () => {
    const p = new Command();
    p.exitOverride();
    registerAgentMemory(p);

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.map(String).join(" "));
    });

    await p.parseAsync(["node", "cli", "agent-memory", "charmander"]);

    const output = logs.join("\n");
    // Should reference scope or profile
    expect(output).toMatch(/scope|profile/i);
  });
});
