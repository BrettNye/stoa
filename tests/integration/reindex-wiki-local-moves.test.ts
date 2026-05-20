/**
 * T8 — reindex walks wiki-local moves at wikis/<wiki>/moves/<id>/SKILL.md
 *
 * Verifies that vault.reindex indexes move SKILL.md files found under any
 * non-_agents wiki, producing entries in _index/pages.json with:
 *   type: "move", wiki: <parent-wiki>, id: <id-from-frontmatter>
 *
 * Also verifies:
 * - _index/tokens.json is populated from wiki-local move bodies
 * - Existing _agents/moves/ entries are unaffected
 * - Scoped reindex also picks up wiki-local moves
 *
 * Attributed to profile-charmeleon. Spec §4.5.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reindex } from "../../src/core/reindex.js";

const SKILL_MD = (wiki: string) => `---
id: move-test
type: move
title: "Test Move"
created: 2026-05-19
wiki: ${wiki}
status: active
summary: "A test wiki-local move"
name: test
description: "Used in integration tests"
move_type: process
scope_wiki: [${wiki}]
applies_to: [claude-code]
---

# Test Move

This is the body of the test move for wiki-local move indexing verification.
`;

describe("T8 — reindex wiki-local moves (wikis/<wiki>/moves/<id>/SKILL.md)", () => {
  let vault: string;

  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), "vault-wiki-local-moves-"));
    mkdirSync(join(vault, "_index"), { recursive: true });

    // Create a non-_agents wiki with a move
    mkdirSync(join(vault, "wikis", "test-wiki", "moves", "move-test"), {
      recursive: true,
    });
    writeFileSync(
      join(vault, "wikis", "test-wiki", "moves", "move-test", "SKILL.md"),
      SKILL_MD("test-wiki")
    );

    // Also create an _agents wiki with its own move to verify no regression
    mkdirSync(
      join(vault, "wikis", "_agents", "moves", "move-agents-test"),
      { recursive: true }
    );
    writeFileSync(
      join(vault, "wikis", "_agents", "moves", "move-agents-test", "SKILL.md"),
      `---
id: move-agents-test
type: move
title: "Agents Test Move"
created: 2026-05-19
wiki: _agents
status: active
summary: "An _agents move for regression checking"
name: agents-test
description: "Ensures _agents moves still index correctly"
move_type: process
applies_to: [claude-code]
---

# Agents Test Move

Body of the agents-scoped test move.
`
    );
  });

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
  });

  it("indexes wiki-local move SKILL.md into _index/pages.json", async () => {
    await reindex(vault);
    const pages = JSON.parse(
      readFileSync(join(vault, "_index", "pages.json"), "utf8")
    ).pages;
    const move = pages.find((p: any) => p.id === "move-test");
    expect(move).toBeDefined();
  });

  it("wiki-local move entry has type: 'move'", async () => {
    await reindex(vault);
    const pages = JSON.parse(
      readFileSync(join(vault, "_index", "pages.json"), "utf8")
    ).pages;
    const move = pages.find((p: any) => p.id === "move-test");
    expect(move.type).toBe("move");
  });

  it("wiki-local move entry has wiki: the parent wiki name", async () => {
    await reindex(vault);
    const pages = JSON.parse(
      readFileSync(join(vault, "_index", "pages.json"), "utf8")
    ).pages;
    const move = pages.find((p: any) => p.id === "move-test");
    expect(move.wiki).toBe("test-wiki");
  });

  it("wiki-local move entry has the correct id from frontmatter", async () => {
    await reindex(vault);
    const pages = JSON.parse(
      readFileSync(join(vault, "_index", "pages.json"), "utf8")
    ).pages;
    const move = pages.find((p: any) => p.id === "move-test");
    expect(move.id).toBe("move-test");
  });

  it("populates tokens.json from wiki-local move body", async () => {
    await reindex(vault);
    const tokens = JSON.parse(
      readFileSync(join(vault, "_index", "tokens.json"), "utf8")
    );
    expect(tokens["move-test"]).toBeDefined();
    // Body contains words like "body", "test", "move", "wiki" — at least one token
    expect(tokens["move-test"].body.length).toBeGreaterThan(0);
  });

  it("_agents/moves/ entries are unchanged (no count change, correct wiki field)", async () => {
    await reindex(vault);
    const pages = JSON.parse(
      readFileSync(join(vault, "_index", "pages.json"), "utf8")
    ).pages;
    const agentsMove = pages.find((p: any) => p.id === "move-agents-test");
    expect(agentsMove).toBeDefined();
    expect(agentsMove.type).toBe("move");
    expect(agentsMove.wiki).toBe("_agents");
  });

  it("both wiki-local and _agents moves are indexed in the same run", async () => {
    await reindex(vault);
    const pages = JSON.parse(
      readFileSync(join(vault, "_index", "pages.json"), "utf8")
    ).pages;
    const ids = pages.map((p: any) => p.id);
    expect(ids).toContain("move-test");
    expect(ids).toContain("move-agents-test");
  });

  it("scoped reindex also picks up wiki-local moves", async () => {
    // Prime the index with a full reindex first (required for scoped merge)
    await reindex(vault);

    // Add a second wiki-local move after the initial full reindex
    mkdirSync(
      join(vault, "wikis", "test-wiki", "moves", "move-test-two"),
      { recursive: true }
    );
    writeFileSync(
      join(vault, "wikis", "test-wiki", "moves", "move-test-two", "SKILL.md"),
      `---
id: move-test-two
type: move
title: "Test Move Two"
created: 2026-05-19
wiki: test-wiki
status: active
summary: "A second test wiki-local move"
name: test-two
description: "Added after initial index"
move_type: process
scope_wiki: [test-wiki]
applies_to: [claude-code]
---

# Test Move Two

Second test move body content.
`
    );

    await reindex(vault, "test-wiki");

    const pages = JSON.parse(
      readFileSync(join(vault, "_index", "pages.json"), "utf8")
    ).pages;
    const move = pages.find((p: any) => p.id === "move-test-two");
    expect(move).toBeDefined();
    expect(move.type).toBe("move");
    expect(move.wiki).toBe("test-wiki");
  });

  it("skips move directories inside a wiki that have no SKILL.md", async () => {
    mkdirSync(
      join(vault, "wikis", "test-wiki", "moves", "move-empty"),
      { recursive: true }
    );
    await reindex(vault);
    const pages = JSON.parse(
      readFileSync(join(vault, "_index", "pages.json"), "utf8")
    ).pages;
    const ids = pages.map((p: any) => p.id);
    expect(ids).not.toContain("move-empty");
  });
});
