import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

// CLI entry point — package.json declares bin: { "stoa": "./dist/bin.js" }.
// Env-var name is STOA_VAULT_PATH per config.ts.
const CLI = join(process.cwd(), "dist", "bin.js");

describe("stoa sync-skills CLI --all", () => {
  let vaultPath: string;
  let repoPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-cli-ss-"));
    repoPath = mkdtempSync(join(tmpdir(), "repo-cli-ss-"));
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    writeFileSync(join(vaultPath, "_index", "deployments.json"), "{}");

    const moveDir = join(vaultPath, "wikis", "_agents", "moves", "move-tdd-cycle");
    mkdirSync(moveDir, { recursive: true });
    writeFileSync(join(moveDir, "SKILL.md"),
      `---\nid: move-tdd-cycle\ntype: move\ntitle: t\ncreated: 2026-05-12\nname: tdd\ndescription: x\napplies_to: [claude-code]\n---\n# t\n`);

    const profilesDir = join(vaultPath, "wikis", "_agents", "profiles");
    mkdirSync(profilesDir, { recursive: true });
    writeFileSync(join(profilesDir, "profile-squirtle.md"),
      `---\nid: profile-squirtle\ntype: profile\ntitle: Sq\ncreated: 2026-05-12\nwiki: _agents\nstatus: active\nsummary: x\npokemon_type: water\nevolution_stage: basic\nmoveset: [move-tdd-cycle]\napplies_to: [claude-code]\n---\n# Sq\n`);
  });
  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    rmSync(repoPath, { recursive: true, force: true });
  });

  it("deploys all profiles' movesets via --all", () => {
    const out = execSync(`node ${CLI} sync-skills ${repoPath} --all --mode copy`, {
      env: { ...process.env, STOA_VAULT_PATH: vaultPath },
    }).toString();
    const result = JSON.parse(out);
    expect(result.summary.deployed).toBe(1);
  });

  it("exits 2 when --pokemon and --all are both passed", () => {
    expect(() =>
      execSync(`node ${CLI} sync-skills ${repoPath} --pokemon squirtle --all`, {
        env: { ...process.env, STOA_VAULT_PATH: vaultPath },
        stdio: "pipe",
      })
    ).toThrow(/mutually exclusive/);
  });
});
