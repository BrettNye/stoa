import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { syncTool } from "../../src/tools/sync.js";
import { readDeployments } from "../../src/core/deployments.js";

let vault: string;
let target: string;

function seedProfile(v: string, id: string, body = "Body\n"): void {
  const dir = join(v, "wikis", "_agents", "profiles");
  mkdirSync(dir, { recursive: true });
  const fm = [
    "---", `id: ${id}`, `title: ${id}`, "type: profile", "wiki: _agents",
    "status: active", "created: '2026-04-30'", "summary: t",
    "pokemon_type: fire", "evolution_stage: basic", "moveset: []",
    "applies_to: [claude-code]",
    "---", "", body
  ].join("\n");
  writeFileSync(join(dir, `${id}.md`), fm);
}

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-mi-"));
  target = mkdtempSync(join(tmpdir(), "vault-mi-target-"));
  mkdirSync(join(vault, "_index"), { recursive: true });
  execSync("git init -q && git config user.email 't@t.t' && git config user.name 't'", { cwd: vault });
  writeFileSync(join(vault, ".gitignore"), "_index/\n");
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
  rmSync(target, { recursive: true, force: true });
});

describe("vault_sync surface=agents — multi-instance concurrent dispatch (v1.7 §7.3)", () => {
  it("two concurrent calls on different Pokemon both land in the registry", async () => {
    seedProfile(vault, "profile-charmander");
    seedProfile(vault, "profile-squirtle");
    execSync("git add . && git commit -q -m seed", { cwd: vault });

    const [r1, r2] = await Promise.all([
      syncTool.handler(
        { surface: "agents", pokemon: "charmander", repo_path: target, runtime: "claude-code" },
        { vaultPath: vault }
      ),
      syncTool.handler(
        { surface: "agents", pokemon: "squirtle", repo_path: target, runtime: "claude-code" },
        { vaultPath: vault }
      )
    ]);

    expect(r1.results[0].status).toBe("deployed");
    expect(r2.results[0].status).toBe("deployed");
    expect(existsSync(join(target, ".claude", "agents", "profile-charmander.md"))).toBe(true);
    expect(existsSync(join(target, ".claude", "agents", "profile-squirtle.md"))).toBe(true);

    const reg = readDeployments(vault);
    expect(Object.keys(reg)).toContain("profile-charmander");
    expect(Object.keys(reg)).toContain("profile-squirtle");
    expect(reg["profile-charmander"]).toHaveLength(1);
    expect(reg["profile-squirtle"]).toHaveLength(1);
  });
});
