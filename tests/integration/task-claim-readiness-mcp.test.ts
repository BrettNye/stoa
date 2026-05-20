import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { taskClaimTool } from "../../src/tools/task-claim.js";

// An ungroomed body that fails all four readiness signals
const UNGROOMED_BODY = "one-line body";

// A groomed body that passes all four readiness signals
const GROOMED_BODY = `# Task: do the thing

## Scope
Implement the feature in src/core/foo.ts.

## Out of scope
No refactoring of unrelated code.

## Verification
- src/core/foo.ts exports FooResult
- tests pass
`;

function writeTaskPage(
  vaultPath: string,
  id: string,
  body: string,
  extra: Record<string, unknown> = {}
): string {
  const updated = new Date().toISOString().slice(0, 10);
  const fm = [
    "---",
    `id: ${id}`,
    `title: Test task`,
    `type: task`,
    `wiki: alpha`,
    `status: pending`,
    `created: ${updated}`,
    `updated: ${updated}`,
    `summary: Test task`,
    ...Object.entries(extra).map(([k, v]) => `${k}: ${String(v)}`),
    "---",
  ].join("\n");
  const content = `${fm}\n${body}`;
  const tasksDir = join(vaultPath, "wikis", "alpha", "tasks");
  writeFileSync(join(tasksDir, `${id}.md`), content, "utf8");
  return updated;
}

describe("vault_task-claim — readiness gate at MCP boundary", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-claim-readiness-mcp-"));
    mkdirSync(join(vaultPath, "wikis", "alpha", "tasks"), { recursive: true });
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("MCP claim surfaces TASK_NOT_READY with structured missing array on ungroomed task", async () => {
    const expected_updated = writeTaskPage(vaultPath, "task-bare", UNGROOMED_BODY);
    await expect(
      taskClaimTool.handler(
        { task_id: "task-bare", agent_id: "charmander", expected_updated },
        { vaultPath, defaultWiki: "alpha" }
      )
    ).rejects.toMatchObject({
      code: "TASK_NOT_READY",
      missing: expect.arrayContaining(["files", "scope"]),
    });
  });

  it("TASK_NOT_READY error carries task_id", async () => {
    const expected_updated = writeTaskPage(vaultPath, "task-bare2", UNGROOMED_BODY);
    let thrown: unknown;
    try {
      await taskClaimTool.handler(
        { task_id: "task-bare2", agent_id: "charmander", expected_updated },
        { vaultPath, defaultWiki: "alpha" }
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toMatchObject({
      code: "TASK_NOT_READY",
      task_id: "task-bare2",
    });
  });

  it("MCP claim with force: true bypasses readiness and returns claimed_by", async () => {
    const expected_updated = writeTaskPage(vaultPath, "task-bare-force", UNGROOMED_BODY);
    const r = await taskClaimTool.handler(
      { task_id: "task-bare-force", agent_id: "charmander", expected_updated, force: true },
      { vaultPath, defaultWiki: "alpha" }
    );
    expect(r.claimed_by).toBe("agent:charmander");
    expect(r.task_id).toBe("task-bare-force");
  });

  it("MCP claim on groomed task (no force) succeeds without TASK_NOT_READY", async () => {
    const expected_updated = writeTaskPage(vaultPath, "task-groomed", GROOMED_BODY);
    const r = await taskClaimTool.handler(
      { task_id: "task-groomed", agent_id: "charmander", expected_updated },
      { vaultPath, defaultWiki: "alpha" }
    );
    expect(r.claimed_by).toBe("agent:charmander");
  });

  it("input schema accepts optional force boolean (Zod parse)", () => {
    // Zod parse — ensures the field is declared optional in the schema
    const schema = (taskClaimTool as any).inputSchema;
    const withForce = schema.parse({
      task_id: "t1",
      agent_id: "a1",
      expected_updated: "2026-05-13",
      force: true,
    });
    expect(withForce.force).toBe(true);

    const withoutForce = schema.parse({
      task_id: "t1",
      agent_id: "a1",
      expected_updated: "2026-05-13",
    });
    expect(withoutForce.force).toBeUndefined();
  });

  it("tool description mentions gate semantics", () => {
    expect(taskClaimTool.description).toMatch(/force/i);
  });
});
