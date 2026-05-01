import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findOnDisk } from "../../src/core/disk-fallback.js";

describe("findOnDisk — generalized id-resolution scanner (v1.7 §5.4)", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-disk-fallback-"));
  });

  it("returns the page when it exists on disk in the expected type-folder", () => {
    mkdirSync(join(vaultPath, "wikis", "alpha", "tasks"), { recursive: true });
    writeFileSync(join(vaultPath, "wikis", "alpha", "tasks", "task-foo.md"), [
      "---",
      "id: task-foo",
      "title: Foo",
      "type: task",
      "wiki: alpha",
      "created: '2026-05-02T12:00:00.000Z'",
      "---",
      "body"
    ].join("\n"));

    const result = findOnDisk(vaultPath, "task-foo");
    expect(result).not.toBeNull();
    expect(result!.frontmatter.id).toBe("task-foo");
    expect(result!.path.endsWith("task-foo.md")).toBe(true);
  });

  it("returns null when the id does not exist anywhere on disk", () => {
    expect(findOnDisk(vaultPath, "task-nonexistent")).toBeNull();
  });

  it("scans across wikis and across type-folders", () => {
    mkdirSync(join(vaultPath, "wikis", "alpha", "specs"), { recursive: true });
    mkdirSync(join(vaultPath, "wikis", "beta", "decisions"), { recursive: true });
    writeFileSync(join(vaultPath, "wikis", "beta", "decisions", "decision-2026-05-02-x.md"), [
      "---",
      "id: decision-2026-05-02-x",
      "title: X",
      "type: decision",
      "wiki: beta",
      "created: '2026-05-02T12:00:00.000Z'",
      "---",
      "body"
    ].join("\n"));

    const result = findOnDisk(vaultPath, "decision-2026-05-02-x");
    expect(result).not.toBeNull();
    expect(result!.frontmatter.wiki).toBe("beta");
  });

  it("returns null on id mismatch (frontmatter id != requested id)", () => {
    mkdirSync(join(vaultPath, "wikis", "alpha", "tasks"), { recursive: true });
    writeFileSync(join(vaultPath, "wikis", "alpha", "tasks", "task-foo.md"), [
      "---",
      "id: task-bar",  // mismatch with file name
      "title: Foo",
      "type: task",
      "wiki: alpha",
      "created: '2026-05-02T12:00:00.000Z'",
      "---",
      "body"
    ].join("\n"));

    expect(findOnDisk(vaultPath, "task-foo")).toBeNull();
  });
});
