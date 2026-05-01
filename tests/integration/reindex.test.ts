import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
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
  it("creates _index/wikis.json with discovered wikis", async () => {
    await reindex(vault);
    const wikis = JSON.parse(readFileSync(join(vault, "_index", "wikis.json"), "utf8"));
    expect(wikis.wikis).toHaveLength(1);
    expect(wikis.wikis[0].name).toBe("alpha");
  });

  it("creates _index/pages.json with all pages", async () => {
    await reindex(vault);
    const pages = JSON.parse(readFileSync(join(vault, "_index", "pages.json"), "utf8"));
    expect(pages.pages.map((p: any) => p.id).sort()).toEqual(["concept-bar", "concept-foo", "map-alpha"]);
  });

  it("creates _index/links.json with forward + inbound edges", async () => {
    await reindex(vault);
    const links = JSON.parse(readFileSync(join(vault, "_index", "links.json"), "utf8"));
    expect(links["concept-foo"].outbound).toContain("concept-bar");
    expect(links["concept-bar"].inbound).toContain("concept-foo");
  });

  it("creates _index/tokens.json with stemmed tokens per page", async () => {
    await reindex(vault);
    const tokens = JSON.parse(readFileSync(join(vault, "_index", "tokens.json"), "utf8"));
    expect(tokens["concept-foo"].title.length).toBeGreaterThan(0);
    expect(tokens["concept-foo"].body.length).toBeGreaterThan(0);
  });

  it("omits family from wikis.json entries when CLAUDE.md has no family field", async () => {
    // Phase-2 T2-1 back-compat: wikis without family declared keep the
    // pre-T2-1 entry shape (no stray `family` key).
    await reindex(vault);
    const wikis = JSON.parse(readFileSync(join(vault, "_index", "wikis.json"), "utf8"));
    const alpha = wikis.wikis.find((w: any) => w.name === "alpha");
    expect(alpha).toBeDefined();
    expect("family" in alpha).toBe(false);
  });

  it("surfaces family from wiki CLAUDE.md onto its wikis.json entry", async () => {
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
    await reindex(vault);
    const wikis = JSON.parse(readFileSync(join(vault, "_index", "wikis.json"), "utf8"));
    const rastate = wikis.wikis.find((w: any) => w.name === "rastate-app");
    expect(rastate).toBeDefined();
    expect(rastate.family).toBe("rastate");
  });

  it("emits an empty families:{} object when no wiki declares a family", async () => {
    // Phase-2 T2-2 — Plan B locks: families key is ALWAYS present for shape
    // stability. With no families declared, it must be the empty object.
    await reindex(vault);
    const wikis = JSON.parse(readFileSync(join(vault, "_index", "wikis.json"), "utf8"));
    expect(wikis.families).toBeDefined();
    expect(wikis.families).toEqual({});
  });

  it("indexes plan files at wikis/<wiki>/plans/*.md (v1.7 §5.7)", async () => {
    const vaultPath = mkdtempSync(join(tmpdir(), "vault-plans-index-"));
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    mkdirSync(join(vaultPath, "wikis", "_meta", "plans"), { recursive: true });
    writeFileSync(join(vaultPath, "wikis", "_meta", "plans", "2026-05-02-plan-x.md"), [
      "---",
      "id: plan-x",
      "title: Plan X",
      "type: plan",
      "wiki: _meta",
      "created: '2026-05-02T12:00:00.000Z'",
      "---",
      "body"
    ].join("\n"));

    await reindex(vaultPath);

    const pages = JSON.parse(readFileSync(join(vaultPath, "_index", "pages.json"), "utf8")).pages;
    expect(pages.some((p: any) => p.id === "plan-x")).toBe(true);
  });

  it("emits a families rollup grouping wikis that share a family", async () => {
    // Phase-2 T2-2 — two wikis with `family: rastate` plus the existing
    // `alpha` wiki (no family) → families.rastate has both rastate-* wikis
    // listed as members (sorted), total_pages sums their per-type page
    // counts, modes_used is deduped + sorted, and alpha (no family)
    // contributes nothing to the rollup.
    mkdirSync(join(vault, "wikis", "rastate-core", "concepts"), { recursive: true });
    writeFileSync(
      join(vault, "wikis", "rastate-core", "CLAUDE.md"),
      "# rastate-core — wiki conventions\n\n**Family:** rastate\n**Mode:** project-doc\n"
    );
    writeFileSync(
      join(vault, "wikis", "rastate-core", "map.md"),
      "---\nid: map-rastate-core\ntype: map\ntitle: Rastate Core\nwiki: rastate-core\nstatus: active\ncreated: 2026-04-30\nupdated: 2026-04-30\nsummary: m\n---\nMap.\n"
    );
    writeFileSync(
      join(vault, "wikis", "rastate-core", "concepts", "concept-state.md"),
      `---
id: concept-state
title: State
type: concept
wiki: rastate-core
status: active
created: 2026-04-30
updated: 2026-04-30
summary: state
tags: [s]
---
Body.
`
    );

    mkdirSync(join(vault, "wikis", "rastate-dev"), { recursive: true });
    writeFileSync(
      join(vault, "wikis", "rastate-dev", "CLAUDE.md"),
      "# rastate-dev — wiki conventions\n\n**Family:** rastate\n**Mode:** idea-map\n"
    );
    writeFileSync(
      join(vault, "wikis", "rastate-dev", "map.md"),
      "---\nid: map-rastate-dev\ntype: map\ntitle: Rastate Dev\nwiki: rastate-dev\nstatus: active\ncreated: 2026-04-30\nupdated: 2026-04-30\nsummary: m\n---\nMap.\n"
    );

    await reindex(vault);
    const wikis = JSON.parse(readFileSync(join(vault, "_index", "wikis.json"), "utf8"));

    expect(wikis.families).toBeDefined();
    expect(wikis.families.rastate).toBeDefined();

    // members sorted alphabetically; alpha (no family) excluded
    expect(wikis.families.rastate.members).toEqual(["rastate-core", "rastate-dev"]);

    // total_pages sums all entries from wikis' page_counts maps:
    //   rastate-core: map-rastate-core (map) + concept-state (concept) = 2
    //   rastate-dev:  map-rastate-dev  (map)                            = 1
    // → 3 total
    expect(wikis.families.rastate.total_pages).toBe(3);

    // v1.7 §5.7 — `mode:` is now read from each wiki's CLAUDE.md
    // (`loadWikiMeta`). Fixtures above declare `**Mode:** project-doc`
    // (rastate-core) and `**Mode:** idea-map` (rastate-dev), so the
    // family's modes_used set should be both, sorted alphabetically.
    expect(wikis.families.rastate.modes_used).toEqual(["idea-map", "project-doc"]);
  });
});

describe("scoped reindex (v1.6.2)", () => {
  let vault: string;

  beforeEach(async () => {
    vault = mkdtempSync(join(tmpdir(), "vault-scoped-"));
    mkdirSync(join(vault, "wikis", "alpha", "concepts"), { recursive: true });
    mkdirSync(join(vault, "wikis", "beta", "concepts"), { recursive: true });
    mkdirSync(join(vault, "_index"), { recursive: true });

    writeFileSync(
      join(vault, "wikis", "alpha", "map.md"),
      `---
id: map-alpha
type: map
title: Alpha
wiki: alpha
status: active
created: 2026-04-28
updated: 2026-04-28
summary: Alpha map
---
Map.
`
    );
    writeFileSync(
      join(vault, "wikis", "alpha", "concepts", "concept-a1.md"),
      `---
id: concept-a1
title: A1
type: concept
wiki: alpha
status: active
created: 2026-04-28
updated: 2026-04-28
summary: An A1 concept
tags: [a]
---
Body about a1.
`
    );
    writeFileSync(
      join(vault, "wikis", "beta", "map.md"),
      `---
id: map-beta
type: map
title: Beta
wiki: beta
status: active
created: 2026-04-28
updated: 2026-04-28
summary: Beta map
---
Map.
`
    );
    writeFileSync(
      join(vault, "wikis", "beta", "concepts", "concept-b1.md"),
      `---
id: concept-b1
title: B1
type: concept
wiki: beta
status: active
created: 2026-04-28
updated: 2026-04-28
summary: A B1 concept
tags: [b]
---
Body about b1.
`
    );

    // Seed: full reindex first so the scoped call has an existing index to merge into.
    await reindex(vault);
  });

  it("preserves other wikis' pages when scoped to one wiki", async () => {
    await reindex(vault, "alpha");
    const pages = JSON.parse(readFileSync(join(vault, "_index", "pages.json"), "utf8"));
    const ids = pages.pages.map((p: any) => p.id).sort();
    expect(ids).toContain("concept-b1");
    expect(ids).toContain("map-beta");
  });

  it("preserves other wikis' tokens when scoped", async () => {
    await reindex(vault, "alpha");
    const tokens = JSON.parse(readFileSync(join(vault, "_index", "tokens.json"), "utf8"));
    expect(tokens["concept-b1"]).toBeDefined();
  });

  it("preserves other wikis' wikis.json entries when scoped", async () => {
    await reindex(vault, "alpha");
    const wikis = JSON.parse(readFileSync(join(vault, "_index", "wikis.json"), "utf8"));
    const names = wikis.wikis.map((w: any) => w.name).sort();
    expect(names).toContain("alpha");
    expect(names).toContain("beta");
  });

  it("rebuilds the scoped wiki's pages — additions are picked up", async () => {
    writeFileSync(
      join(vault, "wikis", "alpha", "concepts", "concept-a2.md"),
      `---
id: concept-a2
title: A2
type: concept
wiki: alpha
status: active
created: 2026-04-28
updated: 2026-04-28
summary: An A2 concept
tags: [a]
---
Body about a2.
`
    );
    await reindex(vault, "alpha");
    const pages = JSON.parse(readFileSync(join(vault, "_index", "pages.json"), "utf8"));
    expect(pages.pages.find((p: any) => p.id === "concept-a2")).toBeDefined();
  });

  it("rebuilds the scoped wiki's pages — deletions drop from index", async () => {
    rmSync(join(vault, "wikis", "alpha", "concepts", "concept-a1.md"));
    await reindex(vault, "alpha");
    const pages = JSON.parse(readFileSync(join(vault, "_index", "pages.json"), "utf8"));
    expect(pages.pages.find((p: any) => p.id === "concept-a1")).toBeUndefined();
    const tokens = JSON.parse(readFileSync(join(vault, "_index", "tokens.json"), "utf8"));
    expect(tokens["concept-a1"]).toBeUndefined();
  });

  it("cleans up stale inbound edges to a deleted scope-page", async () => {
    // beta page links into alpha's concept-a1 via related:
    writeFileSync(
      join(vault, "wikis", "beta", "concepts", "concept-b2.md"),
      `---
id: concept-b2
title: B2
type: concept
wiki: beta
status: active
created: 2026-04-28
updated: 2026-04-28
summary: ""
related: ["[[wikis/alpha/concepts/concept-a1]]"]
---
Body.
`
    );
    await reindex(vault); // full reindex picks up the new beta link
    rmSync(join(vault, "wikis", "alpha", "concepts", "concept-a1.md"));
    await reindex(vault, "alpha");
    const links = JSON.parse(readFileSync(join(vault, "_index", "links.json"), "utf8"));
    // concept-a1 is gone from combinedPages; its inbound entry must be cleared
    // so a stale `inbound: ["concept-b2"]` edge is not retained.
    expect(links["concept-a1"]).toBeUndefined();
    // beta page's outbound still references concept-a1 (dangling outbound is OK;
    // the inbound side is what we care about for index correctness).
  });

  it("rejects reserved wiki not in RESERVED_INCLUDED", async () => {
    await expect(reindex(vault, "_archive")).rejects.toThrow(/reserved/i);
  });

  it("falls back to full reindex when index sidecars are missing", async () => {
    rmSync(join(vault, "_index", "pages.json"));
    await reindex(vault, "alpha"); // should not throw; should rebuild from full
    const pages = JSON.parse(readFileSync(join(vault, "_index", "pages.json"), "utf8"));
    const ids = pages.pages.map((p: any) => p.id).sort();
    expect(ids).toContain("concept-b1"); // beta picked up by fallback full reindex
  });
});

import { mkdtempSync as mkdtempSyncV15, mkdirSync as mkdirSyncV15, writeFileSync as writeFileSyncV15, existsSync as existsSyncV15, readFileSync as readFileSyncV15 } from "node:fs";
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

  it("creates _index/profiles.json with profile rollup", async () => {
    await reindex(vaultPath);
    const path = join(vaultPath, "_index", "profiles.json");
    expect(existsSyncV15(path)).toBe(true);
    const data = JSON.parse(readFileSyncV15(path, "utf8"));
    expect(data["profile-charmander"]).toBeDefined();
    expect(data["profile-charmander"].pokemon_type).toBe("fire");
    expect(data["profile-charmander"].evolution_stage).toBe("basic");
    expect(data["profile-charmander"].tasks_completed).toBe(0);
  });

  it("ensures _index/aliases.json exists (empty if no renames)", async () => {
    await reindex(vaultPath);
    const path = join(vaultPath, "_index", "aliases.json");
    expect(existsSyncV15(path)).toBe(true);
    const data = JSON.parse(readFileSyncV15(path, "utf8"));
    expect(data).toEqual({});
  });

  it("Phase-2 T2-2 — pre-Phase-2 fixtures (no family fields) reindex without regression", async () => {
    // Plan B back-compat lock: an _agents-only vault with no `family:` in any
    // CLAUDE.md must still reindex cleanly. The per-wiki entry must NOT gain
    // a stray `family: null` (omitted only), AND the new top-level
    // `families:` rollup must be emitted as the empty object for shape
    // stability.
    await reindex(vaultPath);
    const wikis = JSON.parse(
      readFileSyncV15(join(vaultPath, "_index", "wikis.json"), "utf8")
    );
    const agents = wikis.wikis.find((w: any) => w.name === "_agents");
    expect(agents).toBeDefined();
    expect("family" in agents).toBe(false);
    expect(wikis.families).toBeDefined();
    expect(wikis.families).toEqual({});
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

  it("indexes profile pages into _index/pages.json", async () => {
    await reindex(vaultPath);
    const pages = JSON.parse(readFileSyncV15(join(vaultPath, "_index", "pages.json"), "utf8"));
    const ids = pages.pages.map((p: any) => p.id);
    expect(ids).toContain("profile-charmander");
    const profile = pages.pages.find((p: any) => p.id === "profile-charmander");
    expect(profile.type).toBe("profile");
    expect(profile.wiki).toBe("_agents");
  });

  it("indexes move SKILL.md pages into _index/pages.json with type=move", async () => {
    await reindex(vaultPath);
    const pages = JSON.parse(readFileSyncV15(join(vaultPath, "_index", "pages.json"), "utf8"));
    const move = pages.pages.find((p: any) => p.id === "move-tdd-cycle");
    expect(move).toBeDefined();
    expect(move.type).toBe("move");
    expect(move.wiki).toBe("_agents");
  });

  it("skips move directories that have no SKILL.md", async () => {
    mkdirSyncV15(join(vaultPath, "wikis", "_agents", "moves", "move-empty"), { recursive: true });
    await reindex(vaultPath);
    const pages = JSON.parse(readFileSyncV15(join(vaultPath, "_index", "pages.json"), "utf8"));
    const ids = pages.pages.map((p: any) => p.id);
    expect(ids).not.toContain("move-empty");
  });
});

describe("reindex — full and scoped paths agree on dangling-target handling (v1.7 §5.5)", () => {
  it("links.json from reindexFull contains no dangling targets", async () => {
    const vaultPath = mkdtempSync(join(tmpdir(), "vault-dangling-"));
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    // Seed: a page that links to a nonexistent target.
    mkdirSync(join(vaultPath, "wikis", "alpha", "concepts"), { recursive: true });
    writeFileSync(join(vaultPath, "wikis", "alpha", "concepts", "concept-source.md"), [
      "---",
      "id: concept-source",
      "title: Source",
      "type: concept",
      "wiki: alpha",
      "created: '2026-05-02T12:00:00.000Z'",
      "---",
      "Body links to [[concept-nonexistent-target]]."
    ].join("\n"));

    await reindex(vaultPath);  // unscoped/full

    const links = JSON.parse(readFileSync(join(vaultPath, "_index", "links.json"), "utf8"));
    expect(links["concept-nonexistent-target"]).toBeUndefined();
  });
});

describe("reindex — concurrent scoped reindex consistency (v1.7 §5.3)", () => {
  it("two concurrent scoped reindexes on different wikis produce consistent sidecars", async () => {
    const vaultPath = mkdtempSync(join(tmpdir(), "vault-reindex-conc-"));
    mkdirSync(join(vaultPath, "_index"), { recursive: true });

    // Seed two wikis (alpha + beta) each with ~10 concept pages.
    for (const w of ["alpha", "beta"]) {
      mkdirSync(join(vaultPath, "wikis", w, "concepts"), { recursive: true });
      writeFileSync(
        join(vaultPath, "wikis", w, "map.md"),
        `---\nid: map-${w}\ntype: map\ntitle: ${w}\nwiki: ${w}\nstatus: active\ncreated: 2026-05-01\nupdated: 2026-05-01\nsummary: m\n---\nMap.\n`
      );
      for (let i = 0; i < 10; i++) {
        writeFileSync(
          join(vaultPath, "wikis", w, "concepts", `concept-${w}-${i}.md`),
          `---
id: concept-${w}-${i}
title: "${w} ${i}"
type: concept
wiki: ${w}
status: active
created: 2026-05-01
updated: 2026-05-01
summary: "${w} ${i}"
tags: [${w}]
---
Body about ${w} ${i}.
`
        );
      }
    }

    // Initial unscoped reindex so the scoped paths have an existing index to merge into.
    await reindex(vaultPath);

    // Capture baseline pages.json size.
    const baselinePages = JSON.parse(readFileSync(join(vaultPath, "_index", "pages.json"), "utf8")).pages.length;

    await Promise.all([
      Promise.resolve().then(() => reindex(vaultPath, "alpha")),
      Promise.resolve().then(() => reindex(vaultPath, "beta")),
    ]);

    const pagesAfter = JSON.parse(readFileSync(join(vaultPath, "_index", "pages.json"), "utf8")).pages.length;

    // Internal consistency: every page in pages.json should have a tokens entry.
    const pageIds = new Set<string>(JSON.parse(readFileSync(join(vaultPath, "_index", "pages.json"), "utf8")).pages.map((p: any) => p.id));
    const tokenKeys = new Set(Object.keys(JSON.parse(readFileSync(join(vaultPath, "_index", "tokens.json"), "utf8"))));
    expect(pageIds.size).toBe(tokenKeys.size);
    for (const id of pageIds) expect(tokenKeys.has(id)).toBe(true);

    // No torn write: page count cannot have shrunk below baseline.
    expect(pagesAfter).toBeGreaterThanOrEqual(baselinePages);
  });
});
