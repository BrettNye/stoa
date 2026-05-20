/**
 * T7 — move-scope-wiki-field integration test
 *
 * Verifies that `scope_wiki:` in a move SKILL.md frontmatter is parsed into
 * an in-memory `scopeWiki: string[]` field on the parsed move record.
 * The field is purely additive at this stage — no deployment behavior changes
 * until T10. This test uses the exported `parseMoveScope` helper.
 *
 * Spec §4.2 — specialist-agent-substrate-design.md
 * Plan: wikis/_meta/plans/2026-05-19-specialist-agent-substrate-dag.md (T7)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseMoveScope } from "../../src/core/skills.js";

describe("T7 — scope_wiki parse round-trip", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-t7-"));
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  function seedMove(moveId: string, extraFrontmatter: string): void {
    const moveDir = join(vaultPath, "wikis", "_agents", "moves", moveId);
    mkdirSync(moveDir, { recursive: true });
    writeFileSync(
      join(moveDir, "SKILL.md"),
      `---
id: ${moveId}
type: move
title: Test Move
created: 2026-05-19
name: test-move
description: Test description
applies_to: [claude-code]
${extraFrontmatter}---

# Test Move
`
    );
  }

  it("parses scope_wiki: [foo] into scopeWiki === ['foo']", () => {
    seedMove("move-scoped", "scope_wiki: [foo]\n");

    const result = parseMoveScope(vaultPath, "move-scoped");

    expect(result.scopeWiki).toEqual(["foo"]);
  });

  it("parses scope_wiki: [crewtracks-modules] into scopeWiki === ['crewtracks-modules']", () => {
    seedMove("move-crewtrack-scoped", "scope_wiki: [crewtracks-modules]\n");

    const result = parseMoveScope(vaultPath, "move-crewtrack-scoped");

    expect(result.scopeWiki).toEqual(["crewtracks-modules"]);
  });

  it("defaults scopeWiki to [] when scope_wiki is absent from frontmatter", () => {
    seedMove("move-portable", "");

    const result = parseMoveScope(vaultPath, "move-portable");

    expect(result.scopeWiki).toEqual([]);
  });

  it("parses scope_wiki with multiple wikis", () => {
    seedMove("move-multi-scope", "scope_wiki: [foo, bar]\n");

    const result = parseMoveScope(vaultPath, "move-multi-scope");

    expect(result.scopeWiki).toEqual(["foo", "bar"]);
  });

  it("coerces non-string scope_wiki values to strings", () => {
    // Seed a move with numeric-looking wiki names (YAML may parse as numbers)
    seedMove("move-coerce", "scope_wiki: [123]\n");

    const result = parseMoveScope(vaultPath, "move-coerce");

    expect(result.scopeWiki).toEqual(["123"]);
  });
});
