import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { syncAgentsTool } from "../../src/tools/sync-agents.js";
import { claudeCodeAdapter } from "../../src/core/runtime-adapters/claude-code.js";
import { buildIntent } from "../../src/core/subagent-intent.js";
import { readDeployments } from "../../src/core/deployments.js";

let vault: string;
let target: string;

function seedProfile(v: string, id: string, fields: Record<string, any>, body: string): void {
  const dir = join(v, "wikis", "_agents", "profiles");
  mkdirSync(dir, { recursive: true });
  const fm = [
    "---",
    `id: ${id}`,
    `title: ${id}`,
    "type: profile",
    "wiki: _agents",
    "status: active",
    "created: '2026-04-30'",
    `summary: ${fields.summary ?? "test"}`,
    `pokemon_type: ${fields.pokemon_type ?? "fire"}`,
    `evolution_stage: ${fields.evolution_stage ?? "basic"}`,
    `moveset: []`,
    "applies_to: [claude-code]",
    "---",
    "",
    body
  ].join("\n");
  writeFileSync(join(dir, `${id}.md`), fm);
}

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-sa-full-"));
  target = mkdtempSync(join(tmpdir(), "vault-sa-target-full-"));
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

describe("vault.sync-agents — full lifecycle (v1.7 §7.3)", () => {
  it("deploys → verifies → removes → re-deploys idempotently → re-deploys on profile edit", async () => {
    seedProfile(vault, "profile-charmander", { pokemon_type: "fire" }, "Backend specialist v1.\n");
    execSync("git add . && git commit -q -m seed", { cwd: vault });

    // Step 1: initial deploy.
    const r1 = await syncAgentsTool.handler(
      { pokemon: "charmander", target, runtime: "claude-code" },
      { vaultPath: vault }
    );
    expect(r1.results[0].status).toBe("deployed");
    const agentPath = r1.results[0].deployed.agent_def;
    expect(existsSync(agentPath)).toBe(true);

    // Step 2: verify the deployed file via the adapter directly.
    const intent = buildIntent(vault, "profile-charmander");
    const v = await claudeCodeAdapter.verify(intent, target);
    expect(v.ok).toBe(true);

    // Step 3: re-deploy at the same source_revision → skipped-no-change.
    const r2 = await syncAgentsTool.handler(
      { pokemon: "charmander", target, runtime: "claude-code" },
      { vaultPath: vault }
    );
    expect(r2.results[0].status).toBe("skipped-no-change");

    // Step 4: edit the profile → new source_revision → re-deploy overwrites.
    const profilePath = join(vault, "wikis", "_agents", "profiles", "profile-charmander.md");
    const orig = readFileSync(profilePath, "utf8");
    writeFileSync(profilePath, orig.replace("v1", "v2"));
    execSync("git add . && git commit -q -m edit", { cwd: vault });
    const r3 = await syncAgentsTool.handler(
      { pokemon: "charmander", target, runtime: "claude-code" },
      { vaultPath: vault }
    );
    expect(r3.results[0].status).toBe("deployed");
    expect(readFileSync(agentPath, "utf8")).toContain("v2");

    // Registry recorded the new source_revision.
    const reg = readDeployments(vault);
    expect(reg["profile-charmander"][0].source_revision).toBe(r3.results[0].registry_entry.source_revision);

    // Step 5: remove via adapter directly + verify file gone.
    const rem = await claudeCodeAdapter.remove(intent, target);
    expect(rem.files_removed).toContain(agentPath);
    expect(existsSync(agentPath)).toBe(false);
  });

  it("warns (does not fail) when settings.json denies a coordination tool", async () => {
    seedProfile(vault, "profile-charmander", { pokemon_type: "fire" }, "Body\n");
    execSync("git add . && git commit -q -m seed", { cwd: vault });
    mkdirSync(join(target, ".claude"), { recursive: true });
    writeFileSync(
      join(target, ".claude", "settings.json"),
      JSON.stringify({ permissions: { deny: ["mcp__vault__vault_channel-post"] } })
    );
    const r = await syncAgentsTool.handler(
      { pokemon: "charmander", target, runtime: "claude-code" },
      { vaultPath: vault }
    );
    expect(r.results[0].status).toBe("deployed");  // not failed
    expect(r.results[0].warnings?.some(w => w.invariant === 6)).toBe(true);
  });

  it("hard-fails when applies_to does not include claude-code (invariant 3)", async () => {
    seedProfile(vault, "profile-openclawonly", { pokemon_type: "fire" }, "Body\n");
    // Override applies_to to exclude claude-code by rewriting the seed.
    const profilePath = join(vault, "wikis", "_agents", "profiles", "profile-openclawonly.md");
    const orig = readFileSync(profilePath, "utf8");
    writeFileSync(profilePath, orig.replace("applies_to: [claude-code]", "applies_to: []"));
    execSync("git add . && git commit -q -m seed", { cwd: vault });

    const r = await syncAgentsTool.handler(
      { pokemon: "openclawonly", target, runtime: "claude-code" },
      { vaultPath: vault }
    );
    expect(r.results[0].status).toBe("failed");
    expect(r.results[0].error).toMatch(/applies_to/);
    expect(existsSync(join(target, ".claude", "agents", "profile-openclawonly.md"))).toBe(false);
  });
});
