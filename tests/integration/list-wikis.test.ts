import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listWikisTool } from "../../src/tools/list-wikis.js";

describe("v1.5 — _agents wiki visibility", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-lw-v15-"));
    mkdirSync(join(vaultPath, "wikis", "alpha"), { recursive: true });
    mkdirSync(join(vaultPath, "wikis", "_agents"), { recursive: true });
    mkdirSync(join(vaultPath, "wikis", "_archive"), { recursive: true });
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    writeFileSync(join(vaultPath, "_index", "wikis.json"), JSON.stringify({
      wikis: [
        { name: "alpha",    mode: "mixed", scope: "", page_counts: {}, last_touched: "2026-04-29" },
        { name: "_agents",  mode: "mixed", scope: "", page_counts: {}, last_touched: "2026-04-29" },
        { name: "_archive", mode: "mixed", scope: "", page_counts: {}, last_touched: "2026-04-29" }
      ]
    }));
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("always exposes _agents (no flag needed)", async () => {
    const r: any = await listWikisTool.handler({ include_reserved: false, group_by_family: false }, { vaultPath });
    const names = r.wikis.map((w: any) => w.name);
    expect(names).toContain("alpha");
    expect(names).toContain("_agents");
    expect(names).not.toContain("_archive");
  });

  it("with include_reserved=true returns _archive too", async () => {
    const r: any = await listWikisTool.handler({ include_reserved: true, group_by_family: false }, { vaultPath });
    const names = r.wikis.map((w: any) => w.name);
    expect(names).toContain("_archive");
  });
});

describe("phase-2 T3-3 — list-wikis family: filter + group_by_family", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-lw-fam-"));
    mkdirSync(join(vaultPath, "wikis"), { recursive: true });
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    // Fixture: 4 rastate-* family members + 1 unfamilied (external-stuff).
    writeFileSync(join(vaultPath, "_index", "wikis.json"), JSON.stringify({
      wikis: [
        { name: "rastate-core",     mode: "project-doc",  scope: "", family: "rastate", page_counts: { concept: 5, decision: 2 }, last_touched: "2026-04-30" },
        { name: "rastate-dev",      mode: "coordination", scope: "", family: "rastate", page_counts: { task: 3, journal: 4 }, last_touched: "2026-04-30" },
        { name: "rastate-ideas",    mode: "idea-map",     scope: "", family: "rastate", page_counts: { idea: 6 }, last_touched: "2026-04-30" },
        { name: "rastate-learning", mode: "learning",     scope: "", family: "rastate", page_counts: { source: 2 }, last_touched: "2026-04-30" },
        { name: "external-stuff",            mode: "project-doc",  scope: "",                    page_counts: { spec: 5, guide: 3 }, last_touched: "2026-04-30" }
      ],
      families: {
        rastate: {
          members: ["rastate-core", "rastate-dev", "rastate-ideas", "rastate-learning"],
          total_pages: 22,
          modes_used: ["coordination", "idea-map", "learning", "project-doc"]
        }
      }
    }));
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("default (no flags) — returns flat wikis array unchanged from v1.5", async () => {
    const r: any = await listWikisTool.handler({ include_reserved: false, group_by_family: false }, { vaultPath });
    expect(Array.isArray(r.wikis)).toBe(true);
    expect(r.families).toBeUndefined();
    expect(r.unfamilied).toBeUndefined();
    const names = r.wikis.map((w: any) => w.name).sort();
    expect(names).toEqual(["external-stuff", "rastate-core", "rastate-dev", "rastate-ideas", "rastate-learning"]);
  });

  it("family: 'rastate' — filters flat wikis array to rastate-* members only", async () => {
    const r: any = await listWikisTool.handler(
      { include_reserved: false, group_by_family: false, family: "rastate" },
      { vaultPath }
    );
    expect(Array.isArray(r.wikis)).toBe(true);
    expect(r.families).toBeUndefined();
    const names = r.wikis.map((w: any) => w.name).sort();
    expect(names).toEqual(["rastate-core", "rastate-dev", "rastate-ideas", "rastate-learning"]);
    expect(names).not.toContain("external-stuff");
  });

  it("group_by_family: true — returns families[] + unfamilied[] shape with full members", async () => {
    const r: any = await listWikisTool.handler(
      { include_reserved: false, group_by_family: true },
      { vaultPath }
    );
    expect(r.wikis).toBeUndefined();
    expect(Array.isArray(r.families)).toBe(true);
    expect(Array.isArray(r.unfamilied)).toBe(true);

    expect(r.families.length).toBe(1);
    const fam = r.families[0];
    expect(fam.name).toBe("rastate");
    expect(fam.total_pages).toBe(22);
    const memberNames = fam.members.map((m: any) => m.name).sort();
    expect(memberNames).toEqual(["rastate-core", "rastate-dev", "rastate-ideas", "rastate-learning"]);

    const unfamNames = r.unfamilied.map((w: any) => w.name).sort();
    expect(unfamNames).toEqual(["external-stuff"]);
  });

  it("family: 'rastate' + group_by_family: true — single family entry, empty unfamilied", async () => {
    const r: any = await listWikisTool.handler(
      { include_reserved: false, group_by_family: true, family: "rastate" },
      { vaultPath }
    );
    expect(Array.isArray(r.families)).toBe(true);
    expect(r.families.length).toBe(1);
    expect(r.families[0].name).toBe("rastate");
    expect(r.unfamilied).toEqual([]);
  });

  it("findOnDisk fallback: page_counts include disk-only pages not yet in idx (v1.7 §5.4)", async () => {
    const v = mkdtempSync(join(tmpdir(), "vault-lw-fallback-"));
    try {
      mkdirSync(join(v, "wikis", "alpha", "concepts"), { recursive: true });
      mkdirSync(join(v, "_index"), { recursive: true });

      // Index says alpha has 1 concept page. (Stale on purpose.)
      writeFileSync(join(v, "_index", "wikis.json"), JSON.stringify({
        wikis: [
          { name: "alpha", mode: "mixed", scope: "", page_counts: { concept: 1 }, last_touched: "2026-05-01" }
        ]
      }));
      writeFileSync(join(v, "_index", "pages.json"), JSON.stringify({
        pages: [
          { id: "concept-indexed", type: "concept", wiki: "alpha", title: "Indexed", summary: "i", tags: [], status: "active", updated: "2026-05-01", created: "2026-05-01", path: "wikis/alpha/concepts/concept-indexed.md" }
        ]
      }));

      // The indexed page on disk.
      writeFileSync(join(v, "wikis", "alpha", "concepts", "concept-indexed.md"), `---
id: concept-indexed
title: Indexed
type: concept
wiki: alpha
status: active
created: 2026-05-01
updated: 2026-05-01
summary: i
---
indexed body
`);
      // A second concept page on disk only — never reindexed.
      writeFileSync(join(v, "wikis", "alpha", "concepts", "concept-disk-only.md"), `---
id: concept-disk-only
title: Disk Only
type: concept
wiki: alpha
status: active
created: 2026-05-01
updated: 2026-05-01
summary: d
---
disk-only body
`);

      const r: any = await listWikisTool.handler(
        { include_reserved: false, group_by_family: false },
        { vaultPath: v }
      );
      const alpha = r.wikis.find((w: any) => w.name === "alpha");
      expect(alpha).toBeDefined();
      // findOnDisk-augmented: the count reflects BOTH the indexed page and
      // the on-disk-only page.
      expect(alpha.page_counts.concept).toBe(2);
    } finally {
      rmSync(v, { recursive: true, force: true });
    }
  });

  it("group_by_family: true with no families in vault — empty families[], all wikis in unfamilied", async () => {
    writeFileSync(join(vaultPath, "_index", "wikis.json"), JSON.stringify({
      wikis: [
        { name: "alpha", mode: "mixed", scope: "", page_counts: {}, last_touched: "2026-04-30" },
        { name: "beta",  mode: "mixed", scope: "", page_counts: {}, last_touched: "2026-04-30" }
      ],
      families: {}
    }));
    const r: any = await listWikisTool.handler(
      { include_reserved: false, group_by_family: true },
      { vaultPath }
    );
    expect(r.families).toEqual([]);
    const unfamNames = r.unfamilied.map((w: any) => w.name).sort();
    expect(unfamNames).toEqual(["alpha", "beta"]);
  });
});
