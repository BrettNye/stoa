import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimTask, AlreadyClaimedError } from "../../src/core/tasks.js";
import { ConflictError } from "../../src/core/pages.js";

let vault: string;

function writeTask(claimedBy?: string) {
  const fm: any = {
    id: "task-foo", title: "Foo", type: "task", wiki: "alpha",
    status: claimedBy ? "claimed" : "pending",
    created: "2026-04-28", updated: "2026-04-28"
  };
  if (claimedBy) fm.claimed_by = claimedBy;
  writeFileSync(
    join(vault, "wikis", "alpha", "tasks", "task-foo.md"),
    `---\n${Object.entries(fm).map(([k,v]) => `${k}: ${typeof v === "string" ? `"${v}"` : v}`).join("\n")}\n---\nWork.\n`
  );
}

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-task-"));
  mkdirSync(join(vault, "wikis", "alpha", "tasks"), { recursive: true });
});

describe("claimTask", () => {
  it("claims an unclaimed task", () => {
    writeTask();
    const result = claimTask(vault, { task_id: "task-foo", agent_id: "claude-code", expected_updated: "2026-04-28" });
    expect(result.claimed_by).toBe("agent:claude-code");
    expect(result.task_id).toBe("task-foo");
  });

  it("idempotent re-claim by same agent", () => {
    writeTask("agent:claude-code");
    const result = claimTask(vault, { task_id: "task-foo", agent_id: "claude-code", expected_updated: "2026-04-28" });
    expect(result.claimed_by).toBe("agent:claude-code");
  });

  it("rejects claim by other agent", () => {
    writeTask("agent:other");
    expect(() => claimTask(vault, { task_id: "task-foo", agent_id: "claude-code", expected_updated: "2026-04-28" }))
      .toThrow(AlreadyClaimedError);
  });

  it("throws ConflictError on stale expected_updated", () => {
    writeTask();
    expect(() => claimTask(vault, { task_id: "task-foo", agent_id: "claude-code", expected_updated: "1999-01-01" }))
      .toThrow(ConflictError);
  });
});
