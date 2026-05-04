// vault-mcp/tests/unit/claims-index.test.ts
//
// Unit tests for the `_index/claims.json` builder (`buildClaimsIndex`).
//
// Plan reference:
// `wikis/_meta/plans/2026-05-02-vault-mcp-claims-plan-1-foundation-dag.md`
// §task-claims-sidecar-builder.
//
// The builder walks every wiki's `claim/` folder, parses each markdown file
// via the shared `ClaimsStore.read` path, and emits the multi-bucket inverted
// index documented in spec §5.4. This test suite covers all six Acceptance
// criteria bullets plus a handful of robustness cases (multi-wiki coverage,
// malformed file skips, empty vault).

import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  buildClaimsIndex,
  writeClaimsIndex,
  type ClaimsIndex,
} from "../../src/core/claims-index.js";
import { mkTempVault, writeClaimFile } from "../helpers.js";

describe("buildClaimsIndex — bucket placement", () => {
  it("indexes a multi-scope claim into all matching buckets", async () => {
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-x",
      key: "x.y",
      profile: ["a", "b"],
      move: ["m1"],
      tags: ["t1"],
      status: "active",
      confidence: 0.7,
    });
    const idx = await buildClaimsIndex(vault);
    expect(idx.by_profile["a"]).toContain("claim-x");
    expect(idx.by_profile["b"]).toContain("claim-x");
    expect(idx.by_move["m1"]).toContain("claim-x");
    expect(idx.by_tag["t1"]).toContain("claim-x");
    expect(idx.global).not.toContain("claim-x");
  });

  it("acceptance bullet 1: profile=[a,b] move=[x] tags=[t] produces four entries (3 profile/move + 1 tag bucket)", async () => {
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-multi",
      key: "multi.scope",
      profile: ["a", "b"],
      move: ["x"],
      tags: ["t"],
      status: "active",
      confidence: 0.8,
    });
    const idx = await buildClaimsIndex(vault);
    expect(idx.by_profile["a"]).toEqual(["claim-multi"]);
    expect(idx.by_profile["b"]).toEqual(["claim-multi"]);
    expect(idx.by_move["x"]).toEqual(["claim-multi"]);
    expect(idx.by_tag["t"]).toEqual(["claim-multi"]);
    // Did NOT land in scope_wiki or global.
    expect(idx.by_scope_wiki).toEqual({});
    expect(idx.global).toEqual([]);
  });

  it("acceptance bullet 2: a claim with all-empty scope arrays appears in `global`", async () => {
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-empty",
      key: "empty.scope",
      status: "active",
      confidence: 0.5,
      // no profile/move/scope_wiki/tags fields → empty arrays
    });
    const idx = await buildClaimsIndex(vault);
    expect(idx.global).toContain("claim-empty");
    expect(idx.by_profile).toEqual({});
    expect(idx.by_move).toEqual({});
    expect(idx.by_scope_wiki).toEqual({});
    expect(idx.by_tag).toEqual({});
  });

  it("acceptance bullet 3: tags-only claim still goes into `global` (tags don't count toward globalness per spec §5.4)", async () => {
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-tags-only",
      key: "tags.only",
      status: "active",
      confidence: 0.6,
      tags: ["foo", "bar"],
      // no profile/move/scope_wiki
    });
    const idx = await buildClaimsIndex(vault);
    expect(idx.global).toContain("claim-tags-only");
    // tags still appear in by_tag — they're indexed but don't disqualify global.
    expect(idx.by_tag["foo"]).toContain("claim-tags-only");
    expect(idx.by_tag["bar"]).toContain("claim-tags-only");
  });

  it("indexes claims into by_scope_wiki when scope_wiki is set", async () => {
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-wiki-scoped",
      key: "wiki.scoped",
      status: "active",
      confidence: 0.7,
      scope_wiki: ["alpha", "beta"],
    });
    const idx = await buildClaimsIndex(vault);
    expect(idx.by_scope_wiki["alpha"]).toContain("claim-wiki-scoped");
    expect(idx.by_scope_wiki["beta"]).toContain("claim-wiki-scoped");
    expect(idx.global).not.toContain("claim-wiki-scoped");
  });

  it("a profile-only claim does not land in `global`", async () => {
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-profile-only",
      key: "profile.only",
      status: "active",
      confidence: 0.7,
      profile: ["charmander"],
    });
    const idx = await buildClaimsIndex(vault);
    expect(idx.by_profile["charmander"]).toContain("claim-profile-only");
    expect(idx.global).not.toContain("claim-profile-only");
  });
});

describe("buildClaimsIndex — status filtering", () => {
  it("acceptance bullet 4a: superseded claims are excluded from all buckets", async () => {
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-old",
      key: "old.fact",
      status: "superseded",
      confidence: 0.6,
      profile: ["a"],
      move: ["m"],
      scope_wiki: ["w"],
      tags: ["t"],
      superseded_by: "claim-new",
    });
    const idx = await buildClaimsIndex(vault);
    expect(idx.by_profile).toEqual({});
    expect(idx.by_move).toEqual({});
    expect(idx.by_scope_wiki).toEqual({});
    expect(idx.by_tag).toEqual({});
    expect(idx.global).toEqual([]);
  });

  it("acceptance bullet 4b: retracted claims are excluded from all buckets", async () => {
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-bad",
      key: "bad.fact",
      status: "retracted",
      confidence: 0.0,
      profile: ["a"],
      move: ["m"],
      tags: ["t"],
    });
    const idx = await buildClaimsIndex(vault);
    expect(idx.by_profile).toEqual({});
    expect(idx.by_move).toEqual({});
    expect(idx.by_tag).toEqual({});
    expect(idx.global).toEqual([]);
  });

  it("draft claims are excluded from all buckets (only `active` is indexed)", async () => {
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-draft",
      key: "wip.fact",
      status: "draft",
      confidence: 0.5,
      profile: ["a"],
    });
    const idx = await buildClaimsIndex(vault);
    expect(idx.by_profile).toEqual({});
    expect(idx.global).toEqual([]);
  });

  it("active and non-active claims coexist; only active ones land in buckets", async () => {
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-live",
      key: "live.fact",
      status: "active",
      confidence: 0.8,
      profile: ["a"],
    });
    await writeClaimFile(vault, {
      id: "claim-dead",
      key: "dead.fact",
      status: "retracted",
      confidence: 0.0,
      profile: ["a"],
    });
    const idx = await buildClaimsIndex(vault);
    expect(idx.by_profile["a"]).toEqual(["claim-live"]);
  });
});

describe("buildClaimsIndex — schema shape", () => {
  it("acceptance bullet 5: returns a `schema_version: 1` shape with all required keys", async () => {
    const vault = await mkTempVault();
    const idx = await buildClaimsIndex(vault);
    expect(idx.schema_version).toBe(1);
    expect(idx).toHaveProperty("by_profile");
    expect(idx).toHaveProperty("by_move");
    expect(idx).toHaveProperty("by_scope_wiki");
    expect(idx).toHaveProperty("by_tag");
    expect(idx).toHaveProperty("global");
    expect(idx).toHaveProperty("generated_at");
    expect(typeof idx.generated_at).toBe("string");
    // ISO 8601 string check.
    expect(() => new Date(idx.generated_at).toISOString()).not.toThrow();
    expect(new Date(idx.generated_at).toISOString()).toBe(idx.generated_at);
  });

  it("returns an empty-shaped index when the vault has no claims", async () => {
    const vault = await mkTempVault();
    const idx = await buildClaimsIndex(vault);
    expect(idx.by_profile).toEqual({});
    expect(idx.by_move).toEqual({});
    expect(idx.by_scope_wiki).toEqual({});
    expect(idx.by_tag).toEqual({});
    expect(idx.global).toEqual([]);
    expect(idx.schema_version).toBe(1);
  });
});

describe("buildClaimsIndex — multi-wiki coverage", () => {
  it("scans claims under every wiki's claim/ directory", async () => {
    const vault = await mkTempVault();
    // mkTempVault pre-creates wikis/_agents/claim. Add a second wiki on the fly.
    await fs.mkdir(path.join(vault, "wikis", "alpha", "claim"), { recursive: true });
    await writeClaimFile(vault, {
      id: "claim-from-agents",
      key: "agents.fact",
      status: "active",
      confidence: 0.7,
      profile: ["a"],
      wiki: "_agents",
    });
    await writeClaimFile(vault, {
      id: "claim-from-alpha",
      key: "alpha.fact",
      status: "active",
      confidence: 0.7,
      profile: ["a"],
      wiki: "alpha",
    });
    const idx = await buildClaimsIndex(vault);
    expect(idx.by_profile["a"]).toContain("claim-from-agents");
    expect(idx.by_profile["a"]).toContain("claim-from-alpha");
  });
});

describe("buildClaimsIndex — robustness", () => {
  it("skips malformed claim files without aborting the index", async () => {
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-good",
      key: "good.fact",
      status: "active",
      confidence: 0.7,
      profile: ["a"],
    });
    // Drop a malformed file in the same directory.
    const bad = path.join(vault, "wikis", "_agents", "claim", "claim-bad.md");
    await fs.writeFile(bad, "not valid frontmatter at all\n", "utf8");
    const idx = await buildClaimsIndex(vault);
    expect(idx.by_profile["a"]).toEqual(["claim-good"]);
  });

  it("returns the empty-shape index even when the wikis/ tree is missing entirely", async () => {
    // mkTempVault always creates wikis/_agents/claim, but the builder must not
    // throw when called against a directory without any wikis subtree.
    const vault = await mkTempVault();
    await fs.rm(path.join(vault, "wikis"), { recursive: true, force: true });
    const idx = await buildClaimsIndex(vault);
    expect(idx.global).toEqual([]);
    expect(idx.schema_version).toBe(1);
  });
});

describe("writeClaimsIndex — atomic persistence", () => {
  it("acceptance bullet 6: writes the sidecar atomically (no partial file on the destination)", async () => {
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-w",
      key: "w.fact",
      status: "active",
      confidence: 0.7,
      profile: ["a"],
    });
    const idx = await buildClaimsIndex(vault);
    await writeClaimsIndex(vault, idx);
    const file = path.join(vault, "_index", "claims.json");
    const raw = await fs.readFile(file, "utf8");
    const parsed: ClaimsIndex = JSON.parse(raw);
    expect(parsed.by_profile["a"]).toContain("claim-w");
    expect(parsed.schema_version).toBe(1);
    // tmp file should not survive a successful rename.
    const tmpExists = await fs
      .access(`${file}.tmp`)
      .then(() => true)
      .catch(() => false);
    expect(tmpExists).toBe(false);
  });

  it("overwrites an existing sidecar with the new shape", async () => {
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-first",
      key: "first.fact",
      status: "active",
      confidence: 0.7,
      profile: ["a"],
    });
    const idx1 = await buildClaimsIndex(vault);
    await writeClaimsIndex(vault, idx1);

    await writeClaimFile(vault, {
      id: "claim-second",
      key: "second.fact",
      status: "active",
      confidence: 0.7,
      profile: ["b"],
    });
    const idx2 = await buildClaimsIndex(vault);
    await writeClaimsIndex(vault, idx2);

    const file = path.join(vault, "_index", "claims.json");
    const parsed: ClaimsIndex = JSON.parse(await fs.readFile(file, "utf8"));
    expect(parsed.by_profile["a"]).toContain("claim-first");
    expect(parsed.by_profile["b"]).toContain("claim-second");
  });
});
