import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readDeployments, recordDeployment } from "../../src/core/deployments.js";

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
