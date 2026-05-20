import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { seedSubstrateTool } from "../../src/tools/seed-substrate.js";
import { parseFrontmatter } from "../../src/core/frontmatter.js";
import { lintTool } from "../../src/tools/lint.js";

describe("integration — seed-substrate against real bundled seed/", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-seed-i-"));
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("copies the real bundled seed/_agents/ tree", async () => {
    const r = await seedSubstrateTool.handler({ vault_path: vaultPath, force: false }, { vaultPath });
    const targetDir = join(vaultPath, "wikis", "_agents");

    // Top-level files
    expect(existsSync(join(targetDir, "README.md"))).toBe(true);
    expect(existsSync(join(targetDir, "CLAUDE.md"))).toBe(true);

    // Profiles
    expect(existsSync(join(targetDir, "profiles", "profile-charmander.md"))).toBe(true);
    expect(existsSync(join(targetDir, "profiles", "profile-squirtle.md"))).toBe(true);
    expect(existsSync(join(targetDir, "profiles", "profile-pidgey.md"))).toBe(true);

    // Moves
    expect(existsSync(join(targetDir, "moves", "move-tdd-cycle", "SKILL.md"))).toBe(true);
    expect(existsSync(join(targetDir, "moves", "move-pr-create", "SKILL.md"))).toBe(true);
    expect(existsSync(join(targetDir, "moves", "move-journal-end-of-task", "SKILL.md"))).toBe(true);
    expect(existsSync(join(targetDir, "moves", "move-channel-coordinate", "SKILL.md"))).toBe(true);

    // Course
    expect(existsSync(join(targetDir, "guides", "guide-course-vault-mcp-onboarding.md"))).toBe(true);

    // Sanity on return shape — every copied file is a string and present
    expect(r.files_copied.length).toBeGreaterThanOrEqual(10);
    expect(r.files_skipped).toEqual([]);
  });

  it("all seeded profile/move frontmatter is parseable and contains expected fields", async () => {
    await seedSubstrateTool.handler({ vault_path: vaultPath, force: false }, { vaultPath });
    const targetDir = join(vaultPath, "wikis", "_agents");

    const profileFiles = readdirSync(join(targetDir, "profiles"));
    for (const f of profileFiles) {
      const raw = readFileSync(join(targetDir, "profiles", f), "utf8");
      const { frontmatter } = parseFrontmatter(raw);
      expect(frontmatter.type).toBe("profile");
      expect(frontmatter.wiki).toBe("_agents");
      expect(frontmatter.evolution_stage).toBe("basic");
      expect(frontmatter.status).toBe("active");
      expect(Array.isArray(frontmatter.moveset)).toBe(true);
    }

    const moveDirs = readdirSync(join(targetDir, "moves"));
    for (const d of moveDirs) {
      const raw = readFileSync(join(targetDir, "moves", d, "SKILL.md"), "utf8");
      const { frontmatter } = parseFrontmatter(raw);
      expect(frontmatter.type).toBe("move");
      expect(frontmatter.wiki).toBe("_agents");
      expect(frontmatter.status).toBe("active");
      expect(Array.isArray(frontmatter.applies_to)).toBe(true);
    }
  });

  it("idempotent re-run: second invocation copies nothing and skips everything", async () => {
    const first = await seedSubstrateTool.handler({ vault_path: vaultPath, force: false }, { vaultPath });
    const second = await seedSubstrateTool.handler({ vault_path: vaultPath, force: false }, { vaultPath });

    expect(second.files_copied).toEqual([]);
    expect(second.files_skipped.length).toBe(first.files_copied.length);
  });

  it("force=true overwrites pre-existing files", async () => {
    // First call lands the files
    await seedSubstrateTool.handler({ vault_path: vaultPath, force: false }, { vaultPath });
    const targetDir = join(vaultPath, "wikis", "_agents");
    const profilePath = join(targetDir, "profiles", "profile-charmander.md");
    const originalContent = readFileSync(profilePath, "utf8");

    // Mutate locally
    const { writeFileSync } = await import("node:fs");
    writeFileSync(profilePath, "LOCAL OVERRIDE\n");
    expect(readFileSync(profilePath, "utf8")).toBe("LOCAL OVERRIDE\n");

    // force=true rewrites it
    const r = await seedSubstrateTool.handler({ vault_path: vaultPath, force: true }, { vaultPath });
    expect(readFileSync(profilePath, "utf8")).toBe(originalContent);
    expect(r.files_skipped).toEqual([]);
  });

  it("vault_lint runs cleanly against the seeded substrate (no errors)", async () => {
    await seedSubstrateTool.handler({ vault_path: vaultPath, force: false }, { vaultPath });

    // Reindex first so lint has fresh sidecars to read.
    const { reindex } = await import("../../src/core/reindex.js");
    await reindex(vaultPath);

    const result = await lintTool.handler({ level: "error" }, { vaultPath });
    // Contract: no error-severity diagnostics against the seeded substrate.
    const errs = (result.diagnostics ?? []).filter((d: any) => d.severity === "error");
    expect(errs).toEqual([]);
  });
});
