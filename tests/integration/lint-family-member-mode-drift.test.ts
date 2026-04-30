import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reindex } from "../../src/core/reindex.js";
import { loadIndex } from "../../src/core/index.js";
import {
  runRegisteredChecks,
  type LintCheckCtx,
} from "../../src/core/lint-check.js";
import type { LintInput, Diagnostic } from "../../src/core/lint.js";

// Wave 1 / Phase-2 T1-3 — registry-backed FAMILY_MEMBER_MODE_DRIFT check.
// Walks the wikis declared in the vault; each wiki's CLAUDE.md may declare
// `family:` and `mode:` (either `key: value` plain or `**Mode:** value`
// markdown-bold). For each family with ≥2 wikis, group by mode; if any
// mode-group has ≥2 wikis, emit ONE warning naming the family + the mode +
// the colliding member names. Different modes within a family are fine —
// that is the whole point of families (per spec §6.3 + Plan B Task 1-3).
//
// Tests invoke `runRegisteredChecks` directly (not the `lint()` function in
// core/lint.ts) — same pattern as tests/integration/lint-cross-wiki-link-broken.test.ts.

let vault: string;

function writeMap(wiki: string) {
  writeFileSync(join(vault, "wikis", wiki, "map.md"), `---
id: map-${wiki}
title: ${wiki}
type: map
wiki: ${wiki}
status: active
created: 2026-04-30
updated: 2026-04-30
summary: m
---
m
`);
}

interface WikiSpec { name: string; mode?: string; family?: string; }

function writeWiki(spec: WikiSpec) {
  const root = join(vault, "wikis", spec.name);
  mkdirSync(root, { recursive: true });
  writeMap(spec.name);
  // Emit the conventional CLAUDE.md fragment used by `vault.new-wiki`:
  // `**Mode:** <mode>` plus an optional `family: <name>` line. The check
  // must accept both the markdown-bold form (today) and plain `mode: <m>`
  // (per spec §5.1) — we exercise mostly markdown-bold here since it
  // reflects the live vault.
  const lines: string[] = [`# ${spec.name} — wiki conventions`, ""];
  if (spec.mode !== undefined) lines.push(`**Mode:** ${spec.mode}`);
  if (spec.family !== undefined) lines.push(`family: ${spec.family}`);
  lines.push("**Scope:** test fixture", "");
  writeFileSync(join(root, "CLAUDE.md"), lines.join("\n"));
}

function runCheck(): Diagnostic[] {
  const idx = loadIndex(vault);
  const ctx: LintCheckCtx = { vaultPath: vault };
  const input: LintInput = {};
  const out = runRegisteredChecks(ctx, idx, input);
  return out.filter(d => d.code === "FAMILY_MEMBER_MODE_DRIFT");
}

beforeAll(async () => {
  // Side-effect import to register the check.
  await import("../../src/core/lint-checks/family-member-mode-drift.js");
});

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-lint-fmmd-"));
  mkdirSync(join(vault, "wikis"), { recursive: true });
  mkdirSync(join(vault, "_index"), { recursive: true });
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

describe("FAMILY_MEMBER_MODE_DRIFT", () => {
  it("single member in a family → no diagnostic", () => {
    writeWiki({ name: "rastate-core", mode: "project-doc", family: "rastate" });
    reindex(vault);
    expect(runCheck()).toEqual([]);
  });

  it("two members in same family with different modes → no diagnostic", () => {
    writeWiki({ name: "rastate-core", mode: "project-doc", family: "rastate" });
    writeWiki({ name: "rastate-ideas", mode: "idea-map", family: "rastate" });
    reindex(vault);
    expect(runCheck()).toEqual([]);
  });

  it("two members in same family with same mode → ONE warning naming both", () => {
    writeWiki({ name: "rastate-a", mode: "idea-map", family: "rastate" });
    writeWiki({ name: "rastate-b", mode: "idea-map", family: "rastate" });
    reindex(vault);
    const hits = runCheck();
    expect(hits.length).toBe(1);
    expect(hits[0].severity).toBe("warning");
    expect(hits[0].code).toBe("FAMILY_MEMBER_MODE_DRIFT");
    // Message should name the family, the colliding mode, and both members.
    expect(hits[0].message).toContain("rastate");
    expect(hits[0].message).toContain("idea-map");
    expect(hits[0].message).toContain("rastate-a");
    expect(hits[0].message).toContain("rastate-b");
  });

  it("three members; two share a mode + one differs → ONE diagnostic for the pair", () => {
    writeWiki({ name: "rastate-a", mode: "idea-map", family: "rastate" });
    writeWiki({ name: "rastate-b", mode: "idea-map", family: "rastate" });
    writeWiki({ name: "rastate-c", mode: "project-doc", family: "rastate" });
    reindex(vault);
    const hits = runCheck();
    expect(hits.length).toBe(1);
    expect(hits[0].severity).toBe("warning");
    expect(hits[0].message).toContain("idea-map");
    expect(hits[0].message).toContain("rastate-a");
    expect(hits[0].message).toContain("rastate-b");
    // The non-colliding member should not be named in the diagnostic.
    expect(hits[0].message).not.toContain("rastate-c");
  });

  it("no families at all → no diagnostic", () => {
    writeWiki({ name: "alpha", mode: "mixed" });
    writeWiki({ name: "beta", mode: "mixed" });
    reindex(vault);
    expect(runCheck()).toEqual([]);
  });
});
