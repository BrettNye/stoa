// tests/integration/sync-agents-deployed-tools.test.ts
//
// Verifies that vault_sync-agents deploys a profile-bound subagent whose
// tools_allowlist includes both vault_agent-memory and vault_claim (the two
// tools added to MINIMAL_COORDINATION_TOOLSET in v1.7.x per task-sync-agents-deploy).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { buildIntent } from "../../src/core/subagent-intent.js";
import { syncAgentsTool } from "../../src/tools/sync-agents.js";

let vault: string;
let target: string;

function seedRepoWithProfile(profileId: string): { vaultPath: string; profileId: string } {
  const dir = join(vault, "wikis", "_agents", "profiles");
  mkdirSync(dir, { recursive: true });
  const fm = [
    "---",
    `id: ${profileId}`,
    `title: ${profileId}`,
    "type: profile",
    "wiki: _agents",
    "status: active",
    "created: '2026-04-30'",
    "summary: test pokemon",
    "pokemon_type: fire",
    "evolution_stage: basic",
    "moveset: []",
    "applies_to: [claude-code]",
    "---",
    "",
    "# Test profile body\n",
  ].join("\n");
  writeFileSync(join(dir, `${profileId}.md`), fm);
  execSync("git add . && git commit -q -m seed", { cwd: vault });
  return { vaultPath: vault, profileId };
}

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-deployed-tools-"));
  target = mkdtempSync(join(tmpdir(), "vault-deployed-tools-target-"));
  mkdirSync(join(vault, "_index"), { recursive: true });
  execSync("git init -q", { cwd: vault });
  execSync('git config user.email "t@t.t"', { cwd: vault });
  execSync('git config user.name "t"', { cwd: vault });
  writeFileSync(join(vault, ".gitignore"), "_index/\n");
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
  rmSync(target, { recursive: true, force: true });
});

describe("sync-agents deployed tools — agent-memory + claim in baseline (task-sync-agents-deploy)", () => {
  it("deployed profile-bound subagent intent includes vault_agent-memory and vault_claim", () => {
    const { vaultPath, profileId } = seedRepoWithProfile("profile-pidgey");
    const intent = buildIntent(vaultPath, profileId);
    expect(intent.tools_allowlist).toContain("vault_agent-memory");
    expect(intent.tools_allowlist).toContain("vault_claim");
  });

  it("the deployed .claude/agents/<id>.md file lists the two new tools in its frontmatter", async () => {
    const { profileId } = seedRepoWithProfile("profile-pidgey");

    const result = await syncAgentsTool.handler(
      { pokemon: "pidgey", target, runtime: "claude-code" },
      { vaultPath: vault }
    );

    expect(result.results[0].status).toBe("deployed");

    const agentPath = join(target, ".claude", "agents", "profile-pidgey.md");
    const content = readFileSync(agentPath, "utf8");

    // The claude-code adapter wire-mangles vault.<name> → mcp__vault__vault_<name>
    expect(content).toContain("mcp__vault__vault_agent-memory");
    expect(content).toContain("mcp__vault__vault_claim");
  });
});
