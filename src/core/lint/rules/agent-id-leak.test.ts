import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkAgentIdLeak } from "./agent-id-leak.js";

describe("AGENT_ID_INPUT_LEAK lint rule", () => {
  it("flags a tool call passing agent_id", () => {
    const dir = mkdtempSync(join(tmpdir(), "stoa-lint-"));
    const file = join(dir, "caller.ts");
    writeFileSync(file, `
      await vault_task-claim({ task_id: "abc", agent_id: "charmander", expected_updated: "2026-05-21" });
    `);
    const issues = checkAgentIdLeak(file);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("AGENT_ID_INPUT_LEAK");
    rmSync(dir, { recursive: true, force: true });
  });

  it("does not flag tools that are not in the removed set", () => {
    const dir = mkdtempSync(join(tmpdir(), "stoa-lint-"));
    const file = join(dir, "caller.ts");
    writeFileSync(file, `vault_recall({ topic: "x", agent_id: "stub" })`);
    const issues = checkAgentIdLeak(file);
    expect(issues).toHaveLength(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it("ignores non-ts/md files", () => {
    const dir = mkdtempSync(join(tmpdir(), "stoa-lint-"));
    const file = join(dir, "caller.json");
    writeFileSync(file, `{ "tool": "vault_task-claim", "agent_id": "x" }`);
    const issues = checkAgentIdLeak(file);
    expect(issues).toHaveLength(0);
    rmSync(dir, { recursive: true, force: true });
  });
});
