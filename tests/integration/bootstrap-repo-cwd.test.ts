import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bootstrapRepoTool } from "../../src/tools/bootstrap-repo.js";

describe("bootstrap-repo — CLAUDE.md emits CWD line (T2-2)", () => {
  let vaultPath: string;
  let repoPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-br-cwd-"));
    repoPath = mkdtempSync(join(tmpdir(), "repo-br-cwd-"));
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    rmSync(repoPath, { recursive: true, force: true });
  });

  it("CLAUDE.md fragment includes a working-directory line referencing the repo path", async () => {
    await bootstrapRepoTool.handler(
      { repo_path: repoPath, wiki: "alpha" },
      { vaultPath }
    );
    const content = readFileSync(join(repoPath, "CLAUDE.md"), "utf8");
    expect(content).toMatch(/working directory|cwd/i);
    // The repo path's last segment should appear in the CLAUDE.md
    expect(content).toContain(repoPath.split(/[/\\]/).slice(-1)[0]);
  });
});
