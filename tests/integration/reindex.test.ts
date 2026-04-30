import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reindex } from "../../src/core/reindex.js";

let vault: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-reidx-"));
  mkdirSync(join(vault, "wikis", "alpha", "concepts"), { recursive: true });
  mkdirSync(join(vault, "_index"), { recursive: true });
  writeFileSync(join(vault, "wikis", "alpha", "CLAUDE.md"), "# alpha\n\nmode: idea-map\nscope: test\n");
  writeFileSync(join(vault, "wikis", "alpha", "map.md"), "---\nid: map-alpha\ntype: map\ntitle: Alpha\ncreated: 2026-04-28\n---\nMap.\n");
  writeFileSync(join(vault, "wikis", "alpha", "concepts", "concept-foo.md"), `---
id: concept-foo
title: Foo
type: concept
wiki: alpha
status: active
created: 2026-04-28
updated: 2026-04-28
summary: A foo concept
tags: [x]
related:
  - "[[wikis/alpha/concepts/concept-bar]]"
---
Body about foo.
`);
  writeFileSync(join(vault, "wikis", "alpha", "concepts", "concept-bar.md"), `---
id: concept-bar
title: Bar
type: concept
wiki: alpha
status: active
created: 2026-04-28
updated: 2026-04-28
summary: A bar concept
tags: [y]
---
Body about bar.
`);
});

describe("reindex", () => {
  it("creates _index/wikis.json with discovered wikis", () => {
    reindex(vault);
    const wikis = JSON.parse(readFileSync(join(vault, "_index", "wikis.json"), "utf8"));
    expect(wikis.wikis).toHaveLength(1);
    expect(wikis.wikis[0].name).toBe("alpha");
  });

  it("creates _index/pages.json with all pages", () => {
    reindex(vault);
    const pages = JSON.parse(readFileSync(join(vault, "_index", "pages.json"), "utf8"));
    expect(pages.pages.map((p: any) => p.id).sort()).toEqual(["concept-bar", "concept-foo", "map-alpha"]);
  });

  it("creates _index/links.json with forward + inbound edges", () => {
    reindex(vault);
    const links = JSON.parse(readFileSync(join(vault, "_index", "links.json"), "utf8"));
    expect(links["concept-foo"].outbound).toContain("concept-bar");
    expect(links["concept-bar"].inbound).toContain("concept-foo");
  });

  it("creates _index/tokens.json with stemmed tokens per page", () => {
    reindex(vault);
    const tokens = JSON.parse(readFileSync(join(vault, "_index", "tokens.json"), "utf8"));
    expect(tokens["concept-foo"].title.length).toBeGreaterThan(0);
    expect(tokens["concept-foo"].body.length).toBeGreaterThan(0);
  });

  it("omits family from wikis.json entries when CLAUDE.md has no family field", () => {
    // Phase-2 T2-1 back-compat: wikis without family declared keep the
    // pre-T2-1 entry shape (no stray `family` key).
    reindex(vault);
    const wikis = JSON.parse(readFileSync(join(vault, "_index", "wikis.json"), "utf8"));
    const alpha = wikis.wikis.find((w: any) => w.name === "alpha");
    expect(alpha).toBeDefined();
    expect("family" in alpha).toBe(false);
  });

  it("surfaces family from wiki CLAUDE.md onto its wikis.json entry", () => {
    // Phase-2 T2-1 — adding a `family:` line to the wiki's CLAUDE.md should
    // make it appear on the IndexedWiki entry after reindex.
    mkdirSync(join(vault, "wikis", "rastate-app"), { recursive: true });
    writeFileSync(
      join(vault, "wikis", "rastate-app", "CLAUDE.md"),
      "# rastate-app — wiki conventions\n\n**Family:** rastate\n**Mode:** project-doc\n"
    );
    writeFileSync(
      join(vault, "wikis", "rastate-app", "map.md"),
      "---\nid: map-rastate-app\ntype: map\ntitle: Rastate App\nwiki: rastate-app\nstatus: active\ncreated: 2026-04-30\nupdated: 2026-04-30\nsummary: m\n---\nMap.\n"
    );
    reindex(vault);
    const wikis = JSON.parse(readFileSync(join(vault, "_index", "wikis.json"), "utf8"));
    const rastate = wikis.wikis.find((w: any) => w.name === "rastate-app");
    expect(rastate).toBeDefined();
    expect(rastate.family).toBe("rastate");
  });
});

import { mkdtempSync as mkdtempSyncV15, mkdirSync as mkdirSyncV15, writeFileSync as writeFileSyncV15, rmSync, existsSync as existsSyncV15, readFileSync as readFileSyncV15 } from "node:fs";
import { afterEach } from "vitest";

describe("v1.5 — reindex profiles + aliases sidecars", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSyncV15(join(tmpdir(), "vault-reindex-v15-"));
    // Minimal vault: _agents wiki with a profile
    mkdirSyncV15(join(vaultPath, "wikis", "_agents", "profiles"), { recursive: true });
    mkdirSyncV15(join(vaultPath, "_index"), { recursive: true });

    writeFileSyncV15(join(vaultPath, "wikis", "_agents", "profiles", "profile-charmander.md"),
      `---
id: profile-charmander
type: profile
title: Charmander
created: 2026-04-29
wiki: _agents
status: active
summary: Backend
pokemon_type: fire
evolution_stage: basic
moveset: []
applies_to: [claude-code]
---

# Charmander
`);
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("creates _index/profiles.json with profile rollup", () => {
    reindex(vaultPath);
    const path = join(vaultPath, "_index", "profiles.json");
    expect(existsSyncV15(path)).toBe(true);
    const data = JSON.parse(readFileSyncV15(path, "utf8"));
    expect(data["profile-charmander"]).toBeDefined();
    expect(data["profile-charmander"].pokemon_type).toBe("fire");
    expect(data["profile-charmander"].evolution_stage).toBe("basic");
    expect(data["profile-charmander"].tasks_completed).toBe(0);
  });

  it("ensures _index/aliases.json exists (empty if no renames)", () => {
    reindex(vaultPath);
    const path = join(vaultPath, "_index", "aliases.json");
    expect(existsSyncV15(path)).toBe(true);
    const data = JSON.parse(readFileSyncV15(path, "utf8"));
    expect(data).toEqual({});
  });
});

describe("v1.5 — discoverPages indexes profiles + moves into pages.json", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSyncV15(join(tmpdir(), "vault-discover-v15-"));
    mkdirSyncV15(join(vaultPath, "wikis", "_agents", "profiles"), { recursive: true });
    mkdirSyncV15(join(vaultPath, "wikis", "_agents", "moves", "move-tdd-cycle"), { recursive: true });
    mkdirSyncV15(join(vaultPath, "_index"), { recursive: true });

    writeFileSyncV15(join(vaultPath, "wikis", "_agents", "profiles", "profile-charmander.md"),
      `---
id: profile-charmander
type: profile
title: Charmander
created: 2026-04-29
wiki: _agents
status: active
summary: Backend
pokemon_type: fire
evolution_stage: basic
moveset: []
applies_to: [claude-code]
---

# Charmander
`);

    writeFileSyncV15(join(vaultPath, "wikis", "_agents", "moves", "move-tdd-cycle", "SKILL.md"),
      `---
id: move-tdd-cycle
type: move
title: "TDD cycle"
created: 2026-04-29
wiki: _agents
status: active
summary: "Red-green-refactor"
name: tdd-cycle
description: "Use when implementing any feature or bugfix"
move_type: process
applies_to: [claude-code]
pokemon_type: ghost
---

# TDD cycle
`);
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("indexes profile pages into _index/pages.json", () => {
    reindex(vaultPath);
    const pages = JSON.parse(readFileSyncV15(join(vaultPath, "_index", "pages.json"), "utf8"));
    const ids = pages.pages.map((p: any) => p.id);
    expect(ids).toContain("profile-charmander");
    const profile = pages.pages.find((p: any) => p.id === "profile-charmander");
    expect(profile.type).toBe("profile");
    expect(profile.wiki).toBe("_agents");
  });

  it("indexes move SKILL.md pages into _index/pages.json with type=move", () => {
    reindex(vaultPath);
    const pages = JSON.parse(readFileSyncV15(join(vaultPath, "_index", "pages.json"), "utf8"));
    const move = pages.pages.find((p: any) => p.id === "move-tdd-cycle");
    expect(move).toBeDefined();
    expect(move.type).toBe("move");
    expect(move.wiki).toBe("_agents");
  });

  it("skips move directories that have no SKILL.md", () => {
    mkdirSyncV15(join(vaultPath, "wikis", "_agents", "moves", "move-empty"), { recursive: true });
    reindex(vaultPath);
    const pages = JSON.parse(readFileSyncV15(join(vaultPath, "_index", "pages.json"), "utf8"));
    const ids = pages.pages.map((p: any) => p.id);
    expect(ids).not.toContain("move-empty");
  });
});
