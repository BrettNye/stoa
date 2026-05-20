import { describe, it, expect, afterEach } from "vitest";
import {
  MINIMAL_COORDINATION_TOOLSET,
  CHANNEL_JOURNAL_PROTOCOL_GUIDANCE,
  mcpToolName,
  mcpToolNamePattern,
} from "../../src/core/subagent-protocol.js";

describe("subagent-protocol — minimal coordination toolset (v1.7 §6.4 invariant 1)", () => {
  it("declares exactly ten tools", () => {
    expect(MINIMAL_COORDINATION_TOOLSET).toHaveLength(10);
  });

  it("includes every tool named by spec §6.4 line 237", () => {
    const expected = [
      "vault_task-claim",
      "vault_task-list",
      "vault_task-update",
      "vault_channel-post",
      "vault_channel-tail",
      "vault_agent-journal",
      "vault_recall",
      "vault_read",
      "vault_agent-memory",
      "vault_claim",
    ];
    for (const t of expected) {
      expect(MINIMAL_COORDINATION_TOOLSET).toContain(t);
    }
  });

  it("is a frozen const (cannot be mutated at runtime)", () => {
    expect(() => {
      // @ts-expect-error — intentional mutation attempt
      MINIMAL_COORDINATION_TOOLSET.push("vault.illegal");
    }).toThrow();
  });
});

describe("subagent-protocol — channel/journal protocol guidance (v1.7 §6.4 invariant 2)", () => {
  it("is between 150 and 300 words (canned ~200-word block)", () => {
    const wordCount = CHANNEL_JOURNAL_PROTOCOL_GUIDANCE.trim().split(/\s+/).length;
    expect(wordCount).toBeGreaterThanOrEqual(150);
    expect(wordCount).toBeLessThanOrEqual(300);
  });

  it("mentions every required protocol step", () => {
    const text = CHANNEL_JOURNAL_PROTOCOL_GUIDANCE.toLowerCase();
    expect(text).toContain("vault_task-claim");
    expect(text).toContain("vault_channel-post");
    expect(text).toContain("vault_channel-tail");
    expect(text).toContain("vault_agent-journal");
    expect(text).toContain("ready signal");
    expect(text).toContain("branch=");
    expect(text).toContain("vault-of-record"); // worktree caveat
  });
});

describe("subagent-protocol — mcpToolName mapping", () => {
  it("maps vault_<name> to mcp__vault__vault_<name>", () => {
    expect(mcpToolName("vault_channel-post")).toBe("mcp__vault__vault_channel-post");
    expect(mcpToolName("vault_task-claim")).toBe("mcp__vault__vault_task-claim");
  });

  it("returns native tool names unchanged", () => {
    expect(mcpToolName("Bash")).toBe("Bash");
    expect(mcpToolName("WebSearch")).toBe("WebSearch");
  });

  it("rejects malformed input with a thrown error", () => {
    expect(() => mcpToolName("")).toThrow();
  });
});

describe("subagent-protocol — server-name resolution", () => {
  const originalEnv = process.env.STOA_MCP_SERVER_NAME;
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.STOA_MCP_SERVER_NAME;
    else process.env.STOA_MCP_SERVER_NAME = originalEnv;
  });

  it("explicit serverName arg wins over env and default", () => {
    process.env.STOA_MCP_SERVER_NAME = "env-name";
    expect(mcpToolName("vault_recall", "explicit-name")).toBe("mcp__explicit-name__vault_recall");
  });

  it("STOA_MCP_SERVER_NAME env var wins over the 'vault' default", () => {
    process.env.STOA_MCP_SERVER_NAME = "stoa";
    expect(mcpToolName("vault_recall")).toBe("mcp__stoa__vault_recall");
  });

  it("falls back to 'vault' when no explicit arg and no env var", () => {
    delete process.env.STOA_MCP_SERVER_NAME;
    expect(mcpToolName("vault_recall")).toBe("mcp__vault__vault_recall");
  });

  it("native tool names ignore server-name resolution entirely", () => {
    process.env.STOA_MCP_SERVER_NAME = "stoa";
    expect(mcpToolName("Bash", "anything")).toBe("Bash");
    expect(mcpToolName("WebSearch")).toBe("WebSearch");
  });
});

describe("subagent-protocol — mcpToolNamePattern (prefix-agnostic match)", () => {
  it("matches a vault_* tool under any server-name prefix", () => {
    const re = mcpToolNamePattern("vault_task-claim");
    expect(re.test("- mcp__vault__vault_task-claim")).toBe(true);
    expect(re.test("- mcp__stoa__vault_task-claim")).toBe(true);
    expect(re.test("- mcp__stoa-dev__vault_task-claim")).toBe(true);
    expect(re.test("- mcp__my_custom__vault_task-claim")).toBe(true);
  });

  it("does NOT match an unrelated tool name", () => {
    const re = mcpToolNamePattern("vault_task-claim");
    expect(re.test("- mcp__vault__vault_recall")).toBe(false);
    expect(re.test("- mcp__stoa__vault_claim")).toBe(false);
  });

  it("treats native tool names without an mcp__ prefix", () => {
    const re = mcpToolNamePattern("Bash");
    expect(re.test("  - Bash")).toBe(true);
    expect(re.test("- WebSearch")).toBe(false);
  });

  it("rejects malformed input with a thrown error", () => {
    expect(() => mcpToolNamePattern("")).toThrow();
  });
});
