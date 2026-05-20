import { describe, it, expect } from "vitest";
import {
  MINIMAL_COORDINATION_TOOLSET,
  CHANNEL_JOURNAL_PROTOCOL_GUIDANCE,
  mcpToolName,
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
