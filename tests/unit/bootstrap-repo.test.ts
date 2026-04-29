import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bootstrapRepoTool } from "../../src/tools/bootstrap-repo.js";

describe("vault.bootstrap-repo", () => {
  let vaultPath: string;
  let repoPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-br-"));
    repoPath = mkdtempSync(join(tmpdir(), "repo-br-"));
    mkdirSync(join(vaultPath, "wikis", "alpha"), { recursive: true });
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    rmSync(repoPath, { recursive: true, force: true });
  });

  it("writes .mcp.json with --default-wiki", async () => {
    const result = await bootstrapRepoTool.handler(
      { repo_path: repoPath, wiki: "alpha" },
      { vaultPath }
    );
    const mcpJsonPath = join(repoPath, ".mcp.json");
    expect(existsSync(mcpJsonPath)).toBe(true);
    const json = JSON.parse(readFileSync(mcpJsonPath, "utf8"));
    expect(json.mcpServers.vault.args).toContain("--default-wiki=alpha");
    expect(result.files_written).toContain(mcpJsonPath);
  });

  it("writes a CLAUDE.md fragment with first-touch instructions", async () => {
    await bootstrapRepoTool.handler(
      { repo_path: repoPath, wiki: "alpha", channels: ["alpha-progress"] },
      { vaultPath }
    );
    const claudeMdPath = join(repoPath, "CLAUDE.md");
    expect(existsSync(claudeMdPath)).toBe(true);
    const content = readFileSync(claudeMdPath, "utf8");
    expect(content).toContain("/start");
    expect(content).toContain("alpha-progress");
  });

  it("merges into existing CLAUDE.md without duplicating", async () => {
    writeFileSync(join(repoPath, "CLAUDE.md"), "# Existing\n\nfoo\n");
    await bootstrapRepoTool.handler(
      { repo_path: repoPath, wiki: "alpha" },
      { vaultPath }
    );
    const content = readFileSync(join(repoPath, "CLAUDE.md"), "utf8");
    expect(content).toContain("# Existing");
    expect(content).toContain("vault-mcp v1.5 bootstrap");

    // Re-run, verify no duplication
    await bootstrapRepoTool.handler(
      { repo_path: repoPath, wiki: "alpha" },
      { vaultPath }
    );
    const content2 = readFileSync(join(repoPath, "CLAUDE.md"), "utf8");
    const matches = content2.match(/vault-mcp v1\.5 bootstrap/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});
