import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { taskCreateTool } from "../../src/tools/task-create.js";

describe("vault.task-create", () => {
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
});
