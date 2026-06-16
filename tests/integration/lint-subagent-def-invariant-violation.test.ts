import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { syncTool } from "../../src/tools/sync.js";
import { lintTool } from "../../src/tools/lint.js";

let vault: string;
let target: string;

function seedProfile(v: string, id: string): void {
  const dir = join(v, "wikis", "_agents", "profiles");
  mkdirSync(dir, { recursive: true });
  const fm = [
    "---", `id: ${id}`, `title: ${id}`, "type: profile", "wiki: _agents",
    "status: active", "created: '2026-04-30'", "summary: t",
    "pokemon_type: fire", "evolution_stage: basic", "moveset: []",
    "applies_to: [claude-code]",
    "---", "", "Body\n"
  ].join("\n");
  writeFileSync(join(dir, `${id}.md`), fm);
}

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-lint-int-"));
  target = mkdtempSync(join(tmpdir(), "vault-lint-int-target-"));
  mkdirSync(join(vault, "_index"), { recursive: true });
  // Minimum reindex prerequisites: a map.md per wiki referenced.
  mkdirSync(join(vault, "wikis", "_agents"), { recursive: true });
  writeFileSync(join(vault, "wikis", "_agents", "map.md"),
    "---\nid: map-_agents\ntype: map\ntitle: Agents\ncreated: 2026-04-30\n---\nMap.\n");
  writeFileSync(join(vault, "wikis", "_agents", "CLAUDE.md"), "# _agents\n\n**Mode:** mixed\n");
  execSync("git init -q && git config user.email 't@t.t' && git config user.name 't'", { cwd: vault });
  writeFileSync(join(vault, ".gitignore"), "_index/\n");
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
  rmSync(target, { recursive: true, force: true });
});

describe("lint — SUBAGENT_DEF_INVARIANT_VIOLATION on a real corrupted artifact (v1.7 §7.3)", () => {
  it("clean after deploy; error after corruption; clean after re-deploy", async () => {
    seedProfile(vault, "profile-charmander");
    execSync("git add . && git commit -q -m seed", { cwd: vault });
    await syncTool.handler(
      { surface: "agents", pokemon: "charmander", repo_path: target, runtime: "claude-code" },
      { vaultPath: vault }
    );

    // Pass 1: clean.
    const r1 = await lintTool.handler({}, { vaultPath: vault });
    const violations1 = r1.diagnostics.filter(d => d.code === "SUBAGENT_DEF_INVARIANT_VIOLATION");
    expect(violations1).toHaveLength(0);

    // Corrupt: remove channel-post from the tools: list.
    const agentPath = join(target, ".claude", "agents", "profile-charmander.md");
    const raw = readFileSync(agentPath, "utf8");
    writeFileSync(agentPath, raw.replace(/^\s*-\s+mcp__vault__vault_channel-post\s*$/m, ""));

    // Pass 2: invariant-1 error.
    const r2 = await lintTool.handler({}, { vaultPath: vault });
    const errs = r2.diagnostics.filter(d =>
      d.code === "SUBAGENT_DEF_INVARIANT_VIOLATION" && d.severity === "error"
    );
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0].suggestion).toContain("vault_sync");

    // Repair via re-deploy.
    await syncTool.handler(
      { surface: "agents", pokemon: "charmander", repo_path: target, runtime: "claude-code", overwrite: true },
      { vaultPath: vault }
    );
    // The re-deploy at the same source_revision returns skipped-no-change but
    // the file is the existing post-corruption file. Force re-write by
    // deleting the file first then re-deploying.
    rmSync(agentPath, { force: true });
    await syncTool.handler(
      { surface: "agents", pokemon: "charmander", repo_path: target, runtime: "claude-code", overwrite: true },
      { vaultPath: vault }
    );

    const r3 = await lintTool.handler({}, { vaultPath: vault });
    const violations3 = r3.diagnostics.filter(d => d.code === "SUBAGENT_DEF_INVARIANT_VIOLATION");
    expect(violations3).toHaveLength(0);
  });
});
