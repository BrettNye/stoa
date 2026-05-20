import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../../src/core/lint-checks/subagent-def-invariant-violation.js";
import { lintCheckRegistry } from "../../src/core/lint-check.js";

describe("SUBAGENT_DEF_INVARIANT_VIOLATION (v1.7 §7.2)", () => {
  let vault: string;
  let target: string;

  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), "vault-lsd-"));
    target = mkdtempSync(join(tmpdir(), "vault-lsd-target-"));
    mkdirSync(join(vault, "_index"), { recursive: true });
  });

  function check() {
    return lintCheckRegistry.find(c => c.code === "SUBAGENT_DEF_INVARIANT_VIOLATION");
  }

  function seedDeployment(absPath: string, agentBody: string): void {
    mkdirSync(join(absPath, "..", ".."), { recursive: true });
    mkdirSync(join(absPath, ".."), { recursive: true });
    writeFileSync(absPath, agentBody);
    writeFileSync(
      join(vault, "_index", "deployments.json"),
      JSON.stringify({
        "profile-charmander": [{
          repo_path: target,
          target: "claude-code",
          mode: "copy",
          actual_mode: "copy",
          runtime: "claude-code",
          source_revision: "abc1234",
          subagent_def_path: absPath,
          synced_at: "2026-05-02T00:00:00.000Z"
        }]
      })
    );
  }

  it("registers the check", () => {
    expect(check()).toBeDefined();
  });

  it("returns no diagnostics on a well-formed agent def (all invariants ok)", () => {
    const wellFormed = [
      "---",
      "name: profile-charmander",
      "description: Use when X",
      "tools:",
      "  - mcp__vault__vault_task-claim",
      "  - mcp__vault__vault_task-list",
      "  - mcp__vault__vault_task-update",
      "  - mcp__vault__vault_channel-post",
      "  - mcp__vault__vault_channel-tail",
      "  - mcp__vault__vault_agent-journal",
      "  - mcp__vault__vault_recall",
      "  - mcp__vault__vault_read",
      "  - mcp__vault__vault_agent-memory",
      "  - mcp__vault__vault_claim",
      "model: inherit",
      "---",
      "",
      "## Channel/journal protocol",
      "",
      "vault_task-claim and the rest are documented here.",
    ].join("\n");
    seedDeployment(join(target, ".claude", "agents", "profile-charmander.md"), wellFormed);
    const diagnostics = check()!.run(
      { vaultPath: vault }, { wikis: [], pages: [], links: {} }, {}
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("flags a missing coordination tool at severity error (invariant 1)", () => {
    // Same as well-formed minus channel-post.
    const broken = [
      "---",
      "name: profile-charmander",
      "tools:",
      "  - mcp__vault__vault_task-claim",
      "  - mcp__vault__vault_task-list",
      "  - mcp__vault__vault_task-update",
      "  - mcp__vault__vault_channel-tail",
      "  - mcp__vault__vault_agent-journal",
      "  - mcp__vault__vault_recall",
      "  - mcp__vault__vault_read",
      "  - mcp__vault__vault_agent-memory",
      "  - mcp__vault__vault_claim",
      "model: inherit",
      "---",
      "",
      "## Channel/journal protocol",
    ].join("\n");
    seedDeployment(join(target, ".claude", "agents", "profile-charmander.md"), broken);
    const diagnostics = check()!.run(
      { vaultPath: vault }, { wikis: [], pages: [], links: {} }, {}
    );
    const errs = diagnostics.filter(d => d.severity === "error" && d.code === "SUBAGENT_DEF_INVARIANT_VIOLATION");
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0].message).toContain("channel-post");
  });

  it("flags missing protocol block at severity error (invariant 2)", () => {
    const noProtocol = [
      "---",
      "name: profile-charmander",
      "tools:",
      "  - mcp__vault__vault_task-claim",
      "  - mcp__vault__vault_task-list",
      "  - mcp__vault__vault_task-update",
      "  - mcp__vault__vault_channel-post",
      "  - mcp__vault__vault_channel-tail",
      "  - mcp__vault__vault_agent-journal",
      "  - mcp__vault__vault_recall",
      "  - mcp__vault__vault_read",
      "  - mcp__vault__vault_agent-memory",
      "  - mcp__vault__vault_claim",
      "model: inherit",
      "---",
      "",
      "(no protocol section)",
    ].join("\n");
    seedDeployment(join(target, ".claude", "agents", "profile-charmander.md"), noProtocol);
    const diagnostics = check()!.run(
      { vaultPath: vault }, { wikis: [], pages: [], links: {} }, {}
    );
    expect(diagnostics.some(d => d.severity === "error" && /protocol/.test(d.message))).toBe(true);
  });

  it("flags settings.json deny at severity warning (invariant 6)", () => {
    const wellFormed = [
      "---",
      "name: profile-charmander",
      "tools:",
      "  - mcp__vault__vault_task-claim",
      "  - mcp__vault__vault_task-list",
      "  - mcp__vault__vault_task-update",
      "  - mcp__vault__vault_channel-post",
      "  - mcp__vault__vault_channel-tail",
      "  - mcp__vault__vault_agent-journal",
      "  - mcp__vault__vault_recall",
      "  - mcp__vault__vault_read",
      "  - mcp__vault__vault_agent-memory",
      "  - mcp__vault__vault_claim",
      "model: inherit",
      "---",
      "",
      "## Channel/journal protocol",
    ].join("\n");
    seedDeployment(join(target, ".claude", "agents", "profile-charmander.md"), wellFormed);
    mkdirSync(join(target, ".claude"), { recursive: true });
    writeFileSync(
      join(target, ".claude", "settings.json"),
      JSON.stringify({ permissions: { deny: ["mcp__vault__vault_channel-post"] } })
    );
    const diagnostics = check()!.run(
      { vaultPath: vault }, { wikis: [], pages: [], links: {} }, {}
    );
    const warns = diagnostics.filter(d => d.severity === "warning" && d.code === "SUBAGENT_DEF_INVARIANT_VIOLATION");
    expect(warns.length).toBeGreaterThan(0);
  });

  it("ignores deployment entries without subagent_def_path (back-compat)", () => {
    writeFileSync(
      join(vault, "_index", "deployments.json"),
      JSON.stringify({
        "profile-charmander": [{
          repo_path: target,
          target: "claude-code",
          mode: "copy",
          synced_at: "2026-04-29T00:00:00.000Z"
        }]
      })
    );
    const diagnostics = check()!.run(
      { vaultPath: vault }, { wikis: [], pages: [], links: {} }, {}
    );
    expect(diagnostics).toHaveLength(0);
  });
});
