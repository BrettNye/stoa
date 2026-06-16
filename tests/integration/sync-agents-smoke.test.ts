import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { syncTool } from "../../src/tools/sync.js";

let vault: string;
let target: string;

function seedProfile(v: string, id: string, fields: Record<string, any> = {}, body = "# Body\n"): void {
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
  vault = mkdtempSync(join(tmpdir(), "vault-sa-smoke-"));
  target = mkdtempSync(join(tmpdir(), "vault-sa-target-"));
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

describe("vault_sync surface=agents — single-Pokemon path (v1.7 §7.1)", () => {
  it("deploys the agent def and records the registry entry", async () => {
    seedProfile(vault, "profile-charmander", { pokemon_type: "fire" }, "Backend specialist.\n");
    execSync("git add . && git commit -q -m seed", { cwd: vault });

    const result = await syncTool.handler(
      { surface: "agents", pokemon: "charmander", repo_path: target, runtime: "claude-code" },
      { vaultPath: vault }
    );
    expect(result.results).toHaveLength(1);
    expect(result.results[0].status).toBe("deployed");
    expect(result.summary.deployed).toBe(1);
    expect(existsSync(join(target, ".claude", "agents", "profile-charmander.md"))).toBe(true);
  });
});
