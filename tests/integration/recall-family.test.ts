// Phase-2 T3-2 — `family:` filter on vault.recall.
//
// Builds a fixture vault with 4 family members of `rastate` plus an unrelated
// `_meta` wiki, each with at least one matching page for the query "auth".
// Verifies the v1.6 §7.1 family resolution semantics:
//
//   - `family:` set, `wiki:` unset → expand scope across all members.
//   - `wiki:` set alone → existing single-wiki behaviour (family unset).
//   - Both set → wiki wins (most-specific). Sanity-check throws on mismatch
//     are covered by the `core/family.ts` unit tests; here we only assert
//     the happy path where wiki is a member of the requested family.
//   - Neither set → existing single-wiki resolution (no family scope).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recallTool } from "../../src/tools/recall.js";
import { reindex } from "../../src/core/reindex.js";

let vault: string;

function writePage(
  vaultPath: string,
  wiki: string,
  folder: string,
  filename: string,
  frontmatter: Record<string, string>,
  body: string
): void {
  mkdirSync(join(vaultPath, "wikis", wiki, folder), { recursive: true });
  const fmLines = Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`).join("\n");
  writeFileSync(
    join(vaultPath, "wikis", wiki, folder, filename),
    `---\n${fmLines}\n---\n${body}\n`
  );
}

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-recall-fam-"));
  mkdirSync(join(vault, "_index"), { recursive: true });

  // Four rastate family members. Each gets a CLAUDE.md declaring `family: rastate`
  // (the WIKI_FAMILY_LINE regex in core/wikis.ts accepts both `family: x` and
  // the markdown-bold `**Family:** x` forms — using the plain form here).
  for (const member of ["rastate-core", "rastate-dev", "rastate-ideas", "rastate-learning"]) {
    mkdirSync(join(vault, "wikis", member), { recursive: true });
    writeFileSync(
      join(vault, "wikis", member, "CLAUDE.md"),
      `# ${member}\n\nfamily: rastate\nmode: project-doc\n`
    );
  }

  // _meta — unrelated wiki, no family declared.
  mkdirSync(join(vault, "wikis", "_meta"), { recursive: true });
  writeFileSync(
    join(vault, "wikis", "_meta", "CLAUDE.md"),
    `# _meta\n\nmode: project-doc\n`
  );

  // One matching page per member + one in _meta. Each has "auth" in tags + body
  // so the recall scoring picks all of them up.
  writePage(vault, "rastate-core", "concepts", "concept-auth-core.md", {
    id: "concept-auth-core",
    title: "Auth core concept",
    type: "concept",
    wiki: "rastate-core",
    status: "active",
    created: "2026-04-30",
    updated: "2026-04-30",
    summary: "Core auth concept",
    tags: "[auth]"
  }, "Authentication core notes.");

  writePage(vault, "rastate-dev", "tasks", "task-auth-dev.md", {
    id: "task-auth-dev",
    title: "Auth dev task",
    type: "task",
    wiki: "rastate-dev",
    status: "active",
    created: "2026-04-30",
    updated: "2026-04-30",
    summary: "Auth dev coordination",
    tags: "[auth]"
  }, "Auth task body.");

  writePage(vault, "rastate-ideas", "ideas", "idea-auth-ideas.md", {
    id: "idea-auth-ideas",
    title: "Auth idea",
    type: "idea",
    wiki: "rastate-ideas",
    status: "active",
    created: "2026-04-30",
    updated: "2026-04-30",
    summary: "Auth exploration",
    tags: "[auth]"
  }, "Auth idea body.");

  writePage(vault, "rastate-learning", "sources", "source-auth-paper.md", {
    id: "source-auth-paper",
    title: "Auth paper",
    type: "source",
    wiki: "rastate-learning",
    status: "active",
    created: "2026-04-30",
    updated: "2026-04-30",
    summary: "External auth paper",
    tags: "[auth]"
  }, "Auth paper distilled.");

  writePage(vault, "_meta", "concepts", "concept-auth-meta.md", {
    id: "concept-auth-meta",
    title: "Meta auth note",
    type: "concept",
    wiki: "_meta",
    status: "active",
    created: "2026-04-30",
    updated: "2026-04-30",
    summary: "Meta-level auth doc",
    tags: "[auth]"
  }, "Meta auth content.");

  reindex(vault);
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

describe("vault.recall — family: filter", () => {
  it("family: 'rastate' (no wiki:) returns hits from all 4 members; no _meta", async () => {
    // layer:"all" so the rastate-dev task (execution layer) is included.
    const r = await recallTool.handler(
      { topic: "auth", family: "rastate", layer: "all", include_archive: false, limit: 20 },
      { vaultPath: vault }
    );
    const wikis = new Set(r.hits.map(h => h.wiki));
    expect(wikis.has("rastate-core")).toBe(true);
    expect(wikis.has("rastate-dev")).toBe(true);
    expect(wikis.has("rastate-ideas")).toBe(true);
    expect(wikis.has("rastate-learning")).toBe(true);
    expect(wikis.has("_meta")).toBe(false);
  });

  it("wiki: 'rastate-core' (family: unset) returns only rastate-core hits", async () => {
    const r = await recallTool.handler(
      { topic: "auth", wiki: "rastate-core", layer: "all", include_archive: false, limit: 20 },
      { vaultPath: vault }
    );
    const wikis = new Set(r.hits.map(h => h.wiki));
    expect(wikis.size).toBe(1);
    expect(wikis.has("rastate-core")).toBe(true);
  });

  it("wiki: AND family: both set → wiki wins (only rastate-core hits)", async () => {
    const r = await recallTool.handler(
      {
        topic: "auth",
        wiki: "rastate-core",
        family: "rastate",
        layer: "all",
        include_archive: false,
        limit: 20
      },
      { vaultPath: vault }
    );
    const wikis = new Set(r.hits.map(h => h.wiki));
    expect(wikis.size).toBe(1);
    expect(wikis.has("rastate-core")).toBe(true);
  });

  it("neither wiki: nor family: → existing v1.5 single-vault behaviour (all wikis searched)", async () => {
    // No defaultWiki / .active-wiki on the test ctx. Recall falls through to
    // the existing path which scopes by `input.wiki` only — when unset, all
    // wikis match (queryPages's wiki filter is skipped when wiki is undefined).
    const r = await recallTool.handler(
      { topic: "auth", layer: "all", include_archive: false, limit: 20 },
      { vaultPath: vault }
    );
    const wikis = new Set(r.hits.map(h => h.wiki));
    // _meta page is in scope when no filter is applied — confirms the no-filter path.
    expect(wikis.has("_meta")).toBe(true);
    expect(wikis.has("rastate-core")).toBe(true);
  });
});
