import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { taskCreateTool } from "../../src/tools/task-create.js";

describe("vault_task-create", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-tc-"));
    mkdirSync(join(vaultPath, "wikis", "alpha", "tasks"), { recursive: true });
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("creates a task with all options", async () => {
    const r = await taskCreateTool.handler({
      title: "feat-x: API",
      wiki: "alpha",
      segregation: ["packages/api/**"],
      required_pokemon_type: "fire",
      channel: "feat-x-progress"
    }, { vaultPath });
    expect(r.id).toMatch(/^task-feat-x-api/);
    expect(r.path).toContain(join("alpha", "tasks"));
  });

  // Regression: bug #4 (2026-05-15) — task-create slug truncation produced
  // mid-word stubs ending in "-on-w" and "-ensure-". Walk back to the
  // previous dash on cut. See
  // wikis/_meta/tasks/task-vault-task-create-truncates-id-slug-mid-word-at-60-chars.md
  describe("regression: word-boundary id truncation (bug-2026-05-15-slug-mid-word)", () => {
    it("never produces a single-letter trailing fragment", async () => {
      const r = await taskCreateTool.handler({
        title: "Fix vault.process-inbox default suggested_id regression on Windows",
        wiki: "alpha",
      }, { vaultPath });
      // The historical bug returned `...regression-on-w`. The fix must
      // either fit the full slug or walk back to a dash boundary.
      expect(r.id).not.toMatch(/-w$/);
      expect(r.id).not.toMatch(/-on-w$/);
      // Last segment must be ≥ 2 chars (no single-letter cuts).
      const segments = r.id.split("-");
      expect(segments[segments.length - 1].length).toBeGreaterThan(1);
    });

    it("never produces a trailing dash from the slug", async () => {
      const r = await taskCreateTool.handler({
        title: "Audit existing wikis for missing type subdirectories; ensure new-wiki scaffolds all 8",
        wiki: "alpha",
      }, { vaultPath });
      expect(r.id).not.toMatch(/-$/);
      // Historical bug returned `...subdirectories-ensure-` (trailing dash
      // got trimmed to `...subdirectories-ensure`). The fix must walk back
      // further when the dash is what was just cut.
      const segments = r.id.split("-");
      expect(segments[segments.length - 1].length).toBeGreaterThan(1);
    });
  });
});
