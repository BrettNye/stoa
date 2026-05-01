import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readDeployments,
  recordDeployment,
  getDeployment,
} from "../../src/core/deployments.js";

describe("DeploymentEntry serde — actual_mode back-compat (T2-2)", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-deployments-"));
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("Case F — v1.5 entry without actual_mode reads back with actual_mode === mode (graceful default)", () => {
    // Hand-write a v1.5-shaped registry.
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    writeFileSync(join(vaultPath, "_index", "deployments.json"), JSON.stringify({
      "profile-charmander": [{
        repo_path: "/fake/repo",
        target: "claude-code",
        mode: "symlink",
        synced_at: "2026-04-29T00:00:00Z"
      }]
    }, null, 2));

    const reg = readDeployments(vaultPath);
    const entry = reg["profile-charmander"][0];
    expect(entry.mode).toBe("symlink");
    expect(entry.actual_mode).toBe("symlink");
  });

  it("Case G — v1.6 entry with explicit actual_mode reads back as written", () => {
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    writeFileSync(join(vaultPath, "_index", "deployments.json"), JSON.stringify({
      "profile-charmander": [{
        repo_path: "/fake/repo",
        target: "claude-code",
        mode: "symlink",
        actual_mode: "copy",
        synced_at: "2026-04-29T00:00:00Z"
      }]
    }, null, 2));

    const reg = readDeployments(vaultPath);
    const entry = reg["profile-charmander"][0];
    expect(entry.mode).toBe("symlink");
    expect(entry.actual_mode).toBe("copy");
  });

  it("recordDeployment persists actual_mode when provided", () => {
    recordDeployment(vaultPath, "profile-charmander", {
      repo_path: "/fake/repo",
      target: "claude-code",
      mode: "symlink",
      actual_mode: "copy",
      synced_at: "2026-04-29T00:00:00Z"
    });
    const reg = readDeployments(vaultPath);
    const entry = reg["profile-charmander"][0];
    expect(entry.actual_mode).toBe("copy");
    expect(entry.mode).toBe("symlink");
  });
});

describe("deployments — v1.7 schema extension (runtime, source_revision, subagent_def_path)", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-deploy-v17-"));
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
  });

  it("reads v1.5/1.6 entries with runtime defaulted to target", () => {
    writeFileSync(
      join(vaultPath, "_index", "deployments.json"),
      JSON.stringify({
        "profile-charmander": [{
          repo_path: "/tmp/repo",
          target: "claude-code",
          mode: "copy",
          synced_at: "2026-04-29T00:00:00.000Z"
        }]
      })
    );
    const reg = readDeployments(vaultPath);
    const entry = reg["profile-charmander"][0];
    expect(entry.runtime).toBe("claude-code");
    expect(entry.source_revision).toBeUndefined();
    expect(entry.subagent_def_path).toBeUndefined();
  });

  it("records and reads back the new fields", () => {
    recordDeployment(vaultPath, "profile-charmander", {
      repo_path: "/tmp/repo",
      target: "claude-code",
      mode: "copy",
      runtime: "claude-code",
      source_revision: "abc1234",
      subagent_def_path: "/tmp/repo/.claude/agents/profile-charmander.md",
      synced_at: "2026-05-02T00:00:00.000Z"
    });
    const reg = readDeployments(vaultPath);
    const entry = reg["profile-charmander"][0];
    expect(entry.runtime).toBe("claude-code");
    expect(entry.source_revision).toBe("abc1234");
    expect(entry.subagent_def_path).toBe("/tmp/repo/.claude/agents/profile-charmander.md");
  });

  it("getDeployment returns the matching entry by (profileId, target)", () => {
    recordDeployment(vaultPath, "profile-charmander", {
      repo_path: "/tmp/repo-a",
      target: "claude-code",
      mode: "copy",
      runtime: "claude-code",
      source_revision: "rev-a",
      subagent_def_path: "/tmp/repo-a/.claude/agents/profile-charmander.md",
      synced_at: "2026-05-02T00:00:00.000Z"
    });
    recordDeployment(vaultPath, "profile-charmander", {
      repo_path: "/tmp/repo-b",
      target: "claude-code",
      mode: "copy",
      runtime: "claude-code",
      source_revision: "rev-b",
      subagent_def_path: "/tmp/repo-b/.claude/agents/profile-charmander.md",
      synced_at: "2026-05-02T00:01:00.000Z"
    });
    const matchA = getDeployment(vaultPath, "profile-charmander", "/tmp/repo-a");
    expect(matchA?.source_revision).toBe("rev-a");
    const matchMissing = getDeployment(vaultPath, "profile-charmander", "/tmp/repo-c");
    expect(matchMissing).toBeUndefined();
  });
});
