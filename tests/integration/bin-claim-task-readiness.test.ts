// tests/integration/bin-claim-task-readiness.test.ts
//
// Integration tests for the CLI `claim-task` command's --force flag and
// TaskNotReadyError pretty-printing.
//
// Pattern: construct a Commander instance directly (same as bin.test.ts uses
// for spawnSync-based tests, but here we call registerClaimTask directly so
// we can inject a temp vault context without spinning a subprocess).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Command } from "commander";
import { registerClaimTask } from "../../src/cli/commands/claim-task.js";
import { setCtx } from "../../src/cli/_ctx.js";

// A one-liner body that fails all four readiness signals (no file refs, no
// scope section, no out-of-scope, no verification).
const UNGROOMED_BODY = "one-line body — not groomed";

// A body that satisfies all four readiness signals.
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

describe("CLI claim-task — --force flag and TaskNotReadyError pretty-printing", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-cli-readiness-"));
    mkdirSync(join(vaultPath, "wikis", "alpha", "tasks"), { recursive: true });
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    // Write the active wiki file so resolveWiki falls back correctly
    writeFileSync(join(vaultPath, ".active-wiki"), "alpha", "utf8");
    // Inject the vault context for getCtx()
    setCtx({ vaultPath, mcpMode: false, defaultWiki: "alpha" });
    // Reset exit code before each test
    process.exitCode = 0;
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  it("exits with code 2 when claiming an ungroomed task without --force", async () => {
    writeTaskPage(vaultPath, "task-bare", UNGROOMED_BODY);

    const p = new Command();
    p.exitOverride(); // prevent process.exit() from terminating the test
    registerClaimTask(p);

    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args.map(String).join(" "));
    });

    await p.parseAsync(["node", "cli", "claim-task", "task-bare", "--as", "charmander"]);

    expect(process.exitCode).toBe(2);
    const errorText = errors.join("\n");
    expect(errorText).toMatch(/TASK_NOT_READY|missing/);
    expect(errorText).toMatch(/--force/);
  });

  it("error output names the missing signals", async () => {
    writeTaskPage(vaultPath, "task-bare", UNGROOMED_BODY);

    const p = new Command();
    p.exitOverride();
    registerClaimTask(p);

    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args.map(String).join(" "));
    });

    await p.parseAsync(["node", "cli", "claim-task", "task-bare", "--as", "charmander"]);

    const errorText = errors.join("\n");
    // The TaskNotReadyError message includes the missing signals
    expect(errorText).toMatch(/files|scope|out_of_scope|verification/);
  });

  it("succeeds and prints 'claimed:' when --force is passed on an ungroomed task", async () => {
    writeTaskPage(vaultPath, "task-bare", UNGROOMED_BODY);

    const p = new Command();
    p.exitOverride();
    registerClaimTask(p);

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.map(String).join(" "));
    });

    await p.parseAsync(["node", "cli", "claim-task", "task-bare", "--as", "charmander", "--force"]);

    expect(process.exitCode).toBe(0);
    expect(logs.join("\n")).toMatch(/^claimed:/);
  });

  it("--force does not affect already-claimed error path", async () => {
    // Write an already-claimed task
    const updated = new Date().toISOString().slice(0, 10);
    const fm = [
      "---",
      `id: task-claimed`,
      `title: Test task`,
      `type: task`,
      `wiki: alpha`,
      `status: claimed`,
      `created: ${updated}`,
      `updated: ${updated}`,
      `summary: Test task`,
      `claimed_by: agent:wartortle`,
      "---",
    ].join("\n");
    writeFileSync(
      join(vaultPath, "wikis", "alpha", "tasks", "task-claimed.md"),
      `${fm}\n${GROOMED_BODY}`,
      "utf8"
    );

    const p = new Command();
    p.exitOverride();
    registerClaimTask(p);

    // With --force, AlreadyClaimedError should still be thrown (not swallowed)
    await expect(
      p.parseAsync(["node", "cli", "claim-task", "task-claimed", "--as", "charmander", "--force"])
    ).rejects.toThrow(/already claimed/i);
  });
});
