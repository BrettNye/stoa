import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { syncAgentsTool } from "../../src/tools/sync-agents.js";

let vault: string;
let target: string;

function seedProfile(v: string, id: string, applies_to: string[], body = "Body\n"): void {
  const dir = join(v, "wikis", "_agents", "profiles");
  mkdirSync(dir, { recursive: true });
  const fm = [
    "---", `id: ${id}`, `title: ${id}`, "type: profile", "wiki: _agents",
    "status: active", "created: '2026-04-30'", "summary: t",
    "pokemon_type: fire", "evolution_stage: basic", "moveset: []",
    `applies_to: [${applies_to.join(", ")}]`,
    "---", "", body
  ].join("\n");
  writeFileSync(join(dir, `${id}.md`), fm);
}

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-mp-"));
  target = mkdtempSync(join(tmpdir(), "vault-mp-target-"));
  mkdirSync(join(vault, "_index"), { recursive: true });
  execSync("git init -q && git config user.email 't@t.t' && git config user.name 't'", { cwd: vault });
  writeFileSync(join(vault, ".gitignore"), "_index/\n");
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
  rmSync(target, { recursive: true, force: true });
});

describe("vault_sync-agents — multi-Pokemon halt-on-first-error (v1.7 §7.1)", () => {
  it("deploys [charmander, broken, squirtle]: charmander deployed, broken failed, squirtle not attempted", async () => {
    seedProfile(vault, "profile-charmander", ["claude-code"]);
    seedProfile(vault, "profile-broken", []);  // applies_to empty → invariant 3 fail
    seedProfile(vault, "profile-squirtle", ["claude-code"]);
    execSync("git add . && git commit -q -m seed", { cwd: vault });

    const r = await syncAgentsTool.handler(
      { pokemon: ["charmander", "broken", "squirtle"], target, runtime: "claude-code" },
      { vaultPath: vault }
    );
    expect(r.results).toHaveLength(2);  // charmander + broken; squirtle NOT in results
    expect(r.results[0].status).toBe("deployed");
    expect(r.results[0].pokemon).toBe("profile-charmander");
    expect(r.results[1].status).toBe("failed");
    expect(r.results[1].pokemon).toBe("profile-broken");
    expect(r.summary).toEqual({ requested: 3, deployed: 1, skipped: 0, failed: 1 });

    // Already-deployed charmander stays on disk.
    expect(existsSync(join(target, ".claude", "agents", "profile-charmander.md"))).toBe(true);
    // Squirtle never attempted.
    expect(existsSync(join(target, ".claude", "agents", "profile-squirtle.md"))).toBe(false);
  });

  it("a clean three-Pokemon batch deploys all three with summary { deployed: 3 }", async () => {
    seedProfile(vault, "profile-charmander", ["claude-code"]);
    seedProfile(vault, "profile-squirtle", ["claude-code"]);
    seedProfile(vault, "profile-bulbasaur", ["claude-code"]);
    execSync("git add . && git commit -q -m seed", { cwd: vault });

    const r = await syncAgentsTool.handler(
      { pokemon: ["charmander", "squirtle", "bulbasaur"], target, runtime: "claude-code" },
      { vaultPath: vault }
    );
    expect(r.results).toHaveLength(3);
    expect(r.results.every(x => x.status === "deployed")).toBe(true);
    expect(r.summary).toEqual({ requested: 3, deployed: 3, skipped: 0, failed: 0 });
  });
});
