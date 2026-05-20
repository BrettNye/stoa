// tests/integration/lint-move-scope-wiki.test.ts
//
// T9 of specialist-agent-substrate DAG. Integration tests for the four
// move-related lint rules (spec §4.6):
//
//   MOVE_SCOPE_WIKI_FOLDER_MISMATCH  (error)   — scope_wiki[0] !== folder wiki
//   MOVE_SCOPE_WIKI_MISSING          (warning) — wiki-local move w/o scope_wiki
//   MOVE_PORTABLE_HAS_SCOPE          (warning) — portable (_agents) move w/ scope_wiki
//   MOVE_ID_SHADOWS_PORTABLE         (warning) — wiki-local move id collides with portable
//
// Hermetic — every test seeds a temp vault on disk under wikis/<wiki>/moves/<id>/SKILL.md
// and runs lintTool.handler against it. No global state.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reindex } from "../../src/core/reindex.js";
import { lintTool } from "../../src/tools/lint.js";

let vault: string;

function writeMap(wiki: string) {
  mkdirSync(join(vault, "wikis", wiki), { recursive: true });
  writeFileSync(
    join(vault, "wikis", wiki, "map.md"),
    `---
id: map-${wiki}
title: ${wiki}
type: map
wiki: ${wiki}
status: active
created: 2026-05-19
updated: 2026-05-19
summary: m
---
m
`,
    "utf8",
  );
}

function writeMove(
  wiki: string,
  moveId: string,
  scopeWiki: string[] | undefined,
) {
  const dir = join(vault, "wikis", wiki, "moves", moveId);
  mkdirSync(dir, { recursive: true });
  const scopeLine =
    scopeWiki === undefined
      ? ""
      : `scope_wiki: [${scopeWiki.join(", ")}]\n`;
  const content = `---
id: ${moveId}
type: move
title: ${moveId}
wiki: ${wiki}
status: active
created: 2026-05-19
updated: 2026-05-19
summary: t
name: ${moveId}
description: t
applies_to: [claude-code]
${scopeLine}---

# ${moveId}
`;
  writeFileSync(join(dir, "SKILL.md"), content, "utf8");
}

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-lint-move-scope-"));
  mkdirSync(join(vault, "_index"), { recursive: true });
  writeMap("_agents");
});

afterEach(() => {
  if (vault) rmSync(vault, { recursive: true, force: true });
});

async function runLint(wiki?: string) {
  await reindex(vault);
  return await lintTool.handler(
    { ...(wiki ? { wiki } : {}), level: "warning" },
    { vaultPath: vault },
  );
}

function hits(diagnostics: Array<{ code: string; page_id?: string }>, code: string) {
  return diagnostics.filter(d => d.code === code);
}

describe("T9 — move-related lint rules", () => {
  describe("MOVE_SCOPE_WIKI_FOLDER_MISMATCH (error)", () => {
    it("emits error when wiki-local move's scope_wiki[0] differs from folder wiki", async () => {
      writeMap("foo");
      writeMove("foo", "move-mismatched", ["other-wiki"]);
      const result = await runLint();
      const h = hits(result.diagnostics, "MOVE_SCOPE_WIKI_FOLDER_MISMATCH");
      expect(h).toHaveLength(1);
      expect(h[0].severity).toBe("error");
      expect(h[0].page_id).toBe("move-mismatched");
    });

    it("does not fire when scope_wiki[0] matches the parent folder wiki", async () => {
      writeMap("foo");
      writeMove("foo", "move-aligned", ["foo"]);
      const result = await runLint();
      const h = hits(result.diagnostics, "MOVE_SCOPE_WIKI_FOLDER_MISMATCH");
      expect(h).toHaveLength(0);
    });

    it("does not fire when scope_wiki is absent (separate rule handles that)", async () => {
      writeMap("foo");
      writeMove("foo", "move-unscoped", undefined);
      const result = await runLint();
      const h = hits(result.diagnostics, "MOVE_SCOPE_WIKI_FOLDER_MISMATCH");
      expect(h).toHaveLength(0);
    });
  });

  describe("MOVE_SCOPE_WIKI_MISSING (warning)", () => {
    it("emits warning when wiki-local move has no scope_wiki", async () => {
      writeMap("foo");
      writeMove("foo", "move-missing-scope", undefined);
      const result = await runLint();
      const h = hits(result.diagnostics, "MOVE_SCOPE_WIKI_MISSING");
      expect(h).toHaveLength(1);
      expect(h[0].severity).toBe("warning");
      expect(h[0].page_id).toBe("move-missing-scope");
    });

    it("does not fire on _agents (portable) moves without scope_wiki", async () => {
      writeMove("_agents", "move-portable-ok", undefined);
      const result = await runLint();
      const h = hits(result.diagnostics, "MOVE_SCOPE_WIKI_MISSING");
      expect(h).toHaveLength(0);
    });

    it("does not fire when wiki-local move has scope_wiki set", async () => {
      writeMap("foo");
      writeMove("foo", "move-has-scope", ["foo"]);
      const result = await runLint();
      const h = hits(result.diagnostics, "MOVE_SCOPE_WIKI_MISSING");
      expect(h).toHaveLength(0);
    });
  });

  describe("MOVE_PORTABLE_HAS_SCOPE (warning)", () => {
    it("emits warning when portable (_agents) move has scope_wiki set", async () => {
      writeMove("_agents", "move-portable-scoped", ["_agents"]);
      const result = await runLint();
      const h = hits(result.diagnostics, "MOVE_PORTABLE_HAS_SCOPE");
      expect(h).toHaveLength(1);
      expect(h[0].severity).toBe("warning");
      expect(h[0].page_id).toBe("move-portable-scoped");
    });

    it("does not fire when portable move has no scope_wiki", async () => {
      writeMove("_agents", "move-portable-bare", undefined);
      const result = await runLint();
      const h = hits(result.diagnostics, "MOVE_PORTABLE_HAS_SCOPE");
      expect(h).toHaveLength(0);
    });

    it("does not fire on a wiki-local move with scope_wiki set", async () => {
      writeMap("foo");
      writeMove("foo", "move-wiki-local-scoped", ["foo"]);
      const result = await runLint();
      const h = hits(result.diagnostics, "MOVE_PORTABLE_HAS_SCOPE");
      expect(h).toHaveLength(0);
    });
  });

  describe("MOVE_ID_SHADOWS_PORTABLE (warning)", () => {
    it("emits warning on the wiki-local move when its id collides with a portable move", async () => {
      writeMap("foo");
      writeMove("_agents", "move-shared-id", undefined);
      writeMove("foo", "move-shared-id", ["foo"]);
      const result = await runLint();
      const h = hits(result.diagnostics, "MOVE_ID_SHADOWS_PORTABLE");
      expect(h).toHaveLength(1);
      expect(h[0].severity).toBe("warning");
      expect(h[0].page_id).toBe("move-shared-id");
      // The diagnostic should be attached to the wiki-local instance (wiki=foo),
      // not to the portable one.
      const fooHit = h.find(d => d.wiki === "foo");
      expect(fooHit).toBeDefined();
    });

    it("does not fire when ids are distinct between portable and wiki-local", async () => {
      writeMap("foo");
      writeMove("_agents", "move-portable-id", undefined);
      writeMove("foo", "move-wiki-local-id", ["foo"]);
      const result = await runLint();
      const h = hits(result.diagnostics, "MOVE_ID_SHADOWS_PORTABLE");
      expect(h).toHaveLength(0);
    });

    it("does not fire when only a portable move with that id exists", async () => {
      writeMove("_agents", "move-portable-only", undefined);
      const result = await runLint();
      const h = hits(result.diagnostics, "MOVE_ID_SHADOWS_PORTABLE");
      expect(h).toHaveLength(0);
    });
  });

  describe("six-predicate combined scenario", () => {
    it("with all six move files seeded, emits exactly the expected four diagnostics", async () => {
      writeMap("foo");
      // 1. Valid portable move (no scope_wiki) → no diagnostics on it.
      writeMove("_agents", "move-portable-clean", undefined);
      // 2. Valid wiki-local move (scope matches folder) → no diagnostics.
      writeMove("foo", "move-wikilocal-clean", ["foo"]);
      // 3. Wiki-local move with scope_wiki: [other-wiki] → FOLDER_MISMATCH.
      writeMove("foo", "move-mismatched", ["other-wiki"]);
      // 4. Wiki-local move with no scope_wiki → MISSING.
      writeMove("foo", "move-missing-scope", undefined);
      // 5. Portable move with scope_wiki: [_agents] → PORTABLE_HAS_SCOPE.
      writeMove("_agents", "move-portable-scoped", ["_agents"]);
      // 6. Wiki-local move sharing id with a portable move → SHADOWS_PORTABLE.
      //    Use a distinct base portable id so we exercise the collision cleanly.
      writeMove("_agents", "move-shadow-target", undefined);
      writeMove("foo", "move-shadow-target", ["foo"]);

      const result = await runLint();

      const mismatch = hits(result.diagnostics, "MOVE_SCOPE_WIKI_FOLDER_MISMATCH");
      expect(mismatch.map(d => d.page_id).sort()).toEqual(["move-mismatched"]);
      expect(mismatch[0].severity).toBe("error");

      const missing = hits(result.diagnostics, "MOVE_SCOPE_WIKI_MISSING");
      expect(missing.map(d => d.page_id).sort()).toEqual(["move-missing-scope"]);
      expect(missing[0].severity).toBe("warning");

      const portableHasScope = hits(result.diagnostics, "MOVE_PORTABLE_HAS_SCOPE");
      expect(portableHasScope.map(d => d.page_id).sort()).toEqual(["move-portable-scoped"]);
      expect(portableHasScope[0].severity).toBe("warning");

      const shadows = hits(result.diagnostics, "MOVE_ID_SHADOWS_PORTABLE");
      // Diagnostic attached to the wiki-local instance only, not the portable one.
      expect(shadows).toHaveLength(1);
      expect(shadows[0].page_id).toBe("move-shadow-target");
      expect(shadows[0].wiki).toBe("foo");
      expect(shadows[0].severity).toBe("warning");

      // Clean files produce no move-rule diagnostics on themselves.
      const cleanIds = ["move-portable-clean", "move-wikilocal-clean"];
      for (const code of [
        "MOVE_SCOPE_WIKI_FOLDER_MISMATCH",
        "MOVE_SCOPE_WIKI_MISSING",
        "MOVE_PORTABLE_HAS_SCOPE",
        "MOVE_ID_SHADOWS_PORTABLE",
      ]) {
        const offending = hits(result.diagnostics, code).filter(d =>
          cleanIds.includes(d.page_id ?? ""),
        );
        expect(offending, `code ${code} should not fire on clean files`).toHaveLength(0);
      }
    });
  });
});
