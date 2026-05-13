// tests/integration/lint-task-pages-walk.test.ts
//
// Integration tests for the generalized walkPagesUnder helper in
// src/core/lint-checks/registration.ts. Validates that:
//   1. The helper iterates non-claim subdirs (e.g. "tasks") when configured.
//   2. Files whose `type:` frontmatter does not match expectedType are skipped.
//   3. Existing claim-rule registrations still work correctly (no regression).
//
// The helper is exercised indirectly by registering a probe rule via the
// public registration surface (registerPerPageRule exported for test use),
// then running vault.lint against a fixture vault.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Internal helper — we test it directly since it is NOT called through vault.lint
// for "tasks" yet (the task-not-ready rule lands in the next DAG task).
// We import via a re-export that registration.ts must provide.
import { walkPagesUnder } from "../../src/core/lint-checks/registration.js";

let vault: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-walk-"));
});

afterEach(() => {
  if (vault) rmSync(vault, { recursive: true, force: true });
});

describe("walkPagesUnder — generalized helper", () => {
  it("yields a page in a non-claim subdir when type matches", () => {
    mkdirSync(join(vault, "wikis/alpha/tasks"), { recursive: true });
    writeFileSync(
      join(vault, "wikis/alpha/tasks/task-foo.md"),
      "---\nid: task-foo\ntype: task\nstatus: pending\n---\nbody",
    );

    const results = [
      ...walkPagesUnder(vault, "tasks", "task", undefined),
    ];

    expect(results).toHaveLength(1);
    expect(results[0].wiki).toBe("alpha");
    expect(results[0].pageId).toBe("task-foo");
    expect(results[0].page.frontmatter?.type).toBe("task");
  });

  it("rejects files whose type frontmatter does not match expectedType", () => {
    mkdirSync(join(vault, "wikis/alpha/tasks"), { recursive: true });
    writeFileSync(
      join(vault, "wikis/alpha/tasks/concept-foo.md"),
      "---\nid: concept-foo\ntype: concept\nstatus: active\n---\nbody",
    );

    const results = [
      ...walkPagesUnder(vault, "tasks", "task", undefined),
    ];

    expect(results).toHaveLength(0);
  });

  it("filters to the specified wiki when wikiFilter is provided", () => {
    mkdirSync(join(vault, "wikis/alpha/tasks"), { recursive: true });
    mkdirSync(join(vault, "wikis/beta/tasks"), { recursive: true });
    writeFileSync(
      join(vault, "wikis/alpha/tasks/task-a.md"),
      "---\nid: task-a\ntype: task\n---\nbody",
    );
    writeFileSync(
      join(vault, "wikis/beta/tasks/task-b.md"),
      "---\nid: task-b\ntype: task\n---\nbody",
    );

    const results = [
      ...walkPagesUnder(vault, "tasks", "task", "alpha"),
    ];

    expect(results).toHaveLength(1);
    expect(results[0].wiki).toBe("alpha");
    expect(results[0].pageId).toBe("task-a");
  });

  it("returns empty when the subdir does not exist in the wiki", () => {
    mkdirSync(join(vault, "wikis/alpha"), { recursive: true });
    // no "tasks" subdir

    const results = [
      ...walkPagesUnder(vault, "tasks", "task", undefined),
    ];

    expect(results).toHaveLength(0);
  });

  it("returns empty when the vault has no wikis dir", () => {
    // vault has no wikis/ directory at all
    const results = [
      ...walkPagesUnder(vault, "claim", "claim", undefined),
    ];

    expect(results).toHaveLength(0);
  });

  it("skips non-.md files", () => {
    mkdirSync(join(vault, "wikis/alpha/tasks"), { recursive: true });
    writeFileSync(join(vault, "wikis/alpha/tasks/task-foo.json"), '{"type":"task"}');
    writeFileSync(
      join(vault, "wikis/alpha/tasks/task-bar.md"),
      "---\nid: task-bar\ntype: task\n---\nbody",
    );

    const results = [
      ...walkPagesUnder(vault, "tasks", "task", undefined),
    ];

    expect(results).toHaveLength(1);
    expect(results[0].pageId).toBe("task-bar");
  });

  it("still iterates claim pages via walkPagesUnder('claim', 'claim', ...)", () => {
    mkdirSync(join(vault, "wikis/alpha/claim"), { recursive: true });
    writeFileSync(
      join(vault, "wikis/alpha/claim/claim-bar.md"),
      [
        "---",
        "id: claim-bar",
        "type: claim",
        "status: active",
        "evidence: []",
        "---",
        "body",
      ].join("\n"),
    );

    const results = [
      ...walkPagesUnder(vault, "claim", "claim", undefined),
    ];

    expect(results).toHaveLength(1);
    expect(results[0].pageId).toBe("claim-bar");
    expect(results[0].page.frontmatter?.type).toBe("claim");
  });
});
