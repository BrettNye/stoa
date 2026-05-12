import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

// CLI entry point — package.json declares bin: { "stoa": "./dist/bin.js" }.
// Build (`npm run build` / `tsc`) emits to dist/ rooted at src/, so the
// runnable entry lands at `dist/bin.js` (NOT dist/cli/main.js as the plan
// originally assumed). Env-var name is STOA_VAULT_PATH per config.ts.
const CLI = join(process.cwd(), "dist", "bin.js");

describe("stoa sync-agents CLI", () => {
  let vaultPath: string;
  let target: string;
  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-cli-sa-"));
    target = mkdtempSync(join(tmpdir(), "repo-cli-sa-"));
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    writeFileSync(join(vaultPath, "_index", "deployments.json"), "{}");
    const profilesDir = join(vaultPath, "wikis", "_agents", "profiles");
    mkdirSync(profilesDir, { recursive: true });
    writeFileSync(join(profilesDir, "profile-squirtle.md"),
      `---
id: profile-squirtle
type: profile
title: Squirtle
created: 2026-05-12
wiki: _agents
status: active
summary: x
pokemon_type: water
evolution_stage: basic
moveset: []
applies_to: [claude-code]
---
# Squirtle
`);
  });
  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  });

  it("deploys a single pokemon via --pokemon flag", () => {
    const out = execSync(`node ${CLI} sync-agents ${target} --pokemon squirtle`, {
      env: { ...process.env, STOA_VAULT_PATH: vaultPath },
    }).toString();
    const result = JSON.parse(out);
    expect(result.summary.deployed).toBe(1);
    expect(existsSync(join(target, ".claude", "agents", "profile-squirtle.md"))).toBe(true);
  });

  it("deploys all profiles via --all", () => {
    const out = execSync(`node ${CLI} sync-agents ${target} --all`, {
      env: { ...process.env, STOA_VAULT_PATH: vaultPath },
    }).toString();
    const result = JSON.parse(out);
    expect(result.summary.deployed).toBe(1);
  });

  it("exits 2 when --pokemon and --all are both passed", () => {
    expect(() =>
      execSync(`node ${CLI} sync-agents ${target} --pokemon squirtle --all`, {
        env: { ...process.env, STOA_VAULT_PATH: vaultPath },
        stdio: "pipe",
      })
    ).toThrow(/mutually exclusive/);
  });

  it("exits 2 when neither --pokemon nor --all is passed", () => {
    expect(() =>
      execSync(`node ${CLI} sync-agents ${target}`, {
        env: { ...process.env, STOA_VAULT_PATH: vaultPath },
        stdio: "pipe",
      })
    ).toThrow(/one of --pokemon or --all/);
  });
});
