import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { syncTool } from "../../src/tools/sync.js";

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
  vault = mkdtempSync(join(tmpdir(), "vault-pc-"));
  target = mkdtempSync(join(tmpdir(), "vault-pc-target-"));
  mkdirSync(join(vault, "_index"), { recursive: true });
  execSync("git init -q && git config user.email 't@t.t' && git config user.name 't'", { cwd: vault });
  writeFileSync(join(vault, ".gitignore"), "_index/\n");
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
  rmSync(target, { recursive: true, force: true });
});

describe("vault_sync surface=agents — invariant-6 permission-conflict surfacing (v1.7 §6.4 + §7.3)", () => {
  it("warns naming the conflicting tool but completes deploy", async () => {
    seedProfile(vault, "profile-charmander");
    execSync("git add . && git commit -q -m seed", { cwd: vault });
    mkdirSync(join(target, ".claude"), { recursive: true });
    writeFileSync(
      join(target, ".claude", "settings.json"),
      JSON.stringify({
        permissions: {
          deny: ["mcp__vault__vault_channel-post"]
        }
      })
    );

    const r = await syncTool.handler(
      { surface: "agents", pokemon: "charmander", repo_path: target, runtime: "claude-code" },
      { vaultPath: vault }
    );
    expect(r.results[0].status).toBe("deployed");  // warning, not error
    const w = r.results[0].warnings?.find(x => x.invariant === 6);
    expect(w).toBeDefined();
    expect(JSON.stringify(w!.context)).toContain("mcp__vault__vault_channel-post");
    expect(existsSync(join(target, ".claude", "agents", "profile-charmander.md"))).toBe(true);
  });

  it("clean deploy when settings.json explicitly allows the toolset", async () => {
    seedProfile(vault, "profile-charmander");
    execSync("git add . && git commit -q -m seed", { cwd: vault });
    mkdirSync(join(target, ".claude"), { recursive: true });
    writeFileSync(
      join(target, ".claude", "settings.json"),
      JSON.stringify({
        permissions: {
          allow: ["mcp__vault__vault_*", "Bash", "Edit", "Read", "Grep", "Glob", "Write"],
          deny: []
        }
      })
    );

    const r = await syncTool.handler(
      { surface: "agents", pokemon: "charmander", repo_path: target, runtime: "claude-code" },
      { vaultPath: vault }
    );
    expect(r.results[0].status).toBe("deployed");
    expect(r.results[0].warnings?.length ?? 0).toBe(0);
  });

  it("glob deny pattern (mcp__vault__*) flags every coordination tool", async () => {
    seedProfile(vault, "profile-charmander");
    execSync("git add . && git commit -q -m seed", { cwd: vault });
    mkdirSync(join(target, ".claude"), { recursive: true });
    writeFileSync(
      join(target, ".claude", "settings.json"),
      JSON.stringify({ permissions: { deny: ["mcp__vault__*"] } })
    );

    const r = await syncTool.handler(
      { surface: "agents", pokemon: "charmander", repo_path: target, runtime: "claude-code" },
      { vaultPath: vault }
    );
    expect(r.results[0].status).toBe("deployed");
    const w = r.results[0].warnings?.find(x => x.invariant === 6);
    expect(w).toBeDefined();
    const conflicts = (w!.context as any)?.conflicting_tools ?? [];
    expect(conflicts.length).toBeGreaterThanOrEqual(8); // all coordination tools matched
  });
});
