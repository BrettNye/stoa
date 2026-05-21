import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { seedSubstrateTool, __setSeedSourceForTesting } from "../../src/tools/seed-substrate.js";

describe("vault_seed-substrate (unit)", () => {
  let vaultPath: string;
  let seedSource: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-seed-u-"));
    seedSource = mkdtempSync(join(tmpdir(), "seed-src-u-"));

    // Build a minimal fake seed source tree
    mkdirSync(join(seedSource, "profiles"), { recursive: true });
    mkdirSync(join(seedSource, "moves", "move-x"), { recursive: true });
    mkdirSync(join(seedSource, "guides"), { recursive: true });

    writeFileSync(join(seedSource, "README.md"), "# seed readme\n");
    writeFileSync(join(seedSource, "CLAUDE.md"), "# seed claudemd\n");
    writeFileSync(
      join(seedSource, "profiles", "profile-foo.md"),
      `---
id: profile-foo
title: Foo
type: profile
wiki: _agents
status: active
pokemon_type: fire
evolution_stage: basic
moveset: [move-x]
applies_to: [claude-code]
---

# Foo
`
    );
    writeFileSync(
      join(seedSource, "moves", "move-x", "SKILL.md"),
      `---
id: move-x
title: X
type: move
wiki: _agents
status: active
name: x
description: x
applies_to: [claude-code]
---

# X
`
    );
    writeFileSync(
      join(seedSource, "guides", "guide-course-foo.md"),
      `---
id: guide-course-foo
title: "Course foo"
type: guide
wiki: _agents
status: active
---

# foo course
`
    );

    __setSeedSourceForTesting(seedSource);
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    rmSync(seedSource, { recursive: true, force: true });
    __setSeedSourceForTesting(null);
  });

  it("copies every seed file into <vault>/wikis/_agents/", async () => {
    const r = await seedSubstrateTool.handler(
      { vault_path: vaultPath, force: false },
      { vaultPath }
    );
    const targetDir = join(vaultPath, "wikis", "_agents");
    expect(existsSync(join(targetDir, "README.md"))).toBe(true);
    expect(existsSync(join(targetDir, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(targetDir, "profiles", "profile-foo.md"))).toBe(true);
    expect(existsSync(join(targetDir, "moves", "move-x", "SKILL.md"))).toBe(true);
    expect(existsSync(join(targetDir, "guides", "guide-course-foo.md"))).toBe(true);

    expect(r.files_copied.length).toBe(5);
    expect(r.files_skipped).toEqual([]);
    expect(r.target_dir).toBe(targetDir);
  });

  it("creates the _agents target directory if it does not exist", async () => {
    expect(existsSync(join(vaultPath, "wikis", "_agents"))).toBe(false);
    await seedSubstrateTool.handler({ vault_path: vaultPath, force: false }, { vaultPath });
    expect(existsSync(join(vaultPath, "wikis", "_agents"))).toBe(true);
  });

  it("skips existing files when force=false", async () => {
    // Pre-populate one file
    const targetDir = join(vaultPath, "wikis", "_agents");
    mkdirSync(join(targetDir, "profiles"), { recursive: true });
    writeFileSync(join(targetDir, "profiles", "profile-foo.md"), "PRE-EXISTING\n");

    const r = await seedSubstrateTool.handler(
      { vault_path: vaultPath, force: false },
      { vaultPath }
    );
    // The pre-existing file should be skipped, not overwritten
    expect(readFileSync(join(targetDir, "profiles", "profile-foo.md"), "utf8")).toBe(
      "PRE-EXISTING\n"
    );
    expect(r.files_skipped.some(p => p.endsWith("profile-foo.md"))).toBe(true);
    // The other four were copied
    expect(r.files_copied.length).toBe(4);
  });

  it("overwrites existing files when force=true", async () => {
    const targetDir = join(vaultPath, "wikis", "_agents");
    mkdirSync(join(targetDir, "profiles"), { recursive: true });
    writeFileSync(join(targetDir, "profiles", "profile-foo.md"), "PRE-EXISTING\n");

    const r = await seedSubstrateTool.handler(
      { vault_path: vaultPath, force: true },
      { vaultPath }
    );
    // The pre-existing file should now have the seed content
    const after = readFileSync(join(targetDir, "profiles", "profile-foo.md"), "utf8");
    expect(after).toContain("id: profile-foo");
    expect(after).not.toContain("PRE-EXISTING");
    expect(r.files_skipped).toEqual([]);
    expect(r.files_copied.length).toBe(5);
  });

  it("idempotent re-run: second call returns all files in skipped[]", async () => {
    await seedSubstrateTool.handler({ vault_path: vaultPath, force: false }, { vaultPath });
    const second = await seedSubstrateTool.handler(
      { vault_path: vaultPath, force: false },
      { vaultPath }
    );
    expect(second.files_copied).toEqual([]);
    expect(second.files_skipped.length).toBe(5);
  });

  it("defaults vault_path to ctx.vaultPath when omitted", async () => {
    const r = await seedSubstrateTool.handler({ force: false }, { vaultPath });
    expect(r.target_dir).toBe(join(vaultPath, "wikis", "_agents"));
    expect(r.files_copied.length).toBe(5);
  });
});
