// vault-mcp/tests/integration/reindex-claims.test.ts
//
// task-reindex-claims-integration — verify that `reindex()` (full and scoped)
// builds and writes the `_index/claims.json` sidecar via `buildClaimsIndex` +
// `writeClaimsIndex`. Acceptance bullets checked:
//
// 1. After full reindex, `_index/claims.json` exists with the canonical shape:
//    `{ by_profile, by_move, by_scope_wiki, by_tag, global, generated_at, schema_version: 1 }`.
// 2. Only `status: "active"` claims are bucketed; superseded/retracted/draft
//    are skipped silently.
// 3. Tags-only claims (empty profile/move/scope_wiki) land in `global` and are
//    additionally indexed under `by_tag`.
// 4. profile/move/scope_wiki dimensions populate their respective inverted
//    buckets.
// 5. Empty vault (no claim files anywhere) still emits a sidecar with the full
//    shape and empty buckets — never a missing file.
// 6. Scoped reindex (`reindex(vault, "<wiki>")`) also rebuilds the sidecar; it
//    is built from a full vault scan, so a different wiki's claims are still
//    visible afterwards.
//
// Plan ref: wikis/_meta/plans/2026-05-02-vault-mcp-claims-plan-1-foundation-dag.md
//   §task-reindex-claims-integration.

import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { reindex } from "../../src/core/reindex.js";
import { mkTempVault, writeClaimFile } from "../helpers.js";

interface SidecarShape {
  by_profile: Record<string, string[]>;
  by_move: Record<string, string[]>;
  by_scope_wiki: Record<string, string[]>;
  by_tag: Record<string, string[]>;
  global: string[];
  generated_at: string;
  schema_version: number;
}

async function readSidecar(vault: string): Promise<SidecarShape> {
  const raw = await fs.readFile(join(vault, "_index", "claims.json"), "utf8");
  return JSON.parse(raw) as SidecarShape;
}

describe("reindex — claims sidecar integration", () => {
  it("emits _index/claims.json with the canonical shape after full reindex", async () => {
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-alpha",
      key: "subject.alpha",
      status: "active",
      confidence: 0.8,
      profile: ["profile-charmander"],
    });

    await reindex(vault);

    const idx = await readSidecar(vault);
    expect(idx.schema_version).toBe(1);
    expect(typeof idx.generated_at).toBe("string");
    expect(idx.generated_at.length).toBeGreaterThan(0);
    expect(idx.by_profile).toBeDefined();
    expect(idx.by_move).toBeDefined();
    expect(idx.by_scope_wiki).toBeDefined();
    expect(idx.by_tag).toBeDefined();
    expect(Array.isArray(idx.global)).toBe(true);
    expect(idx.by_profile["profile-charmander"]).toEqual(["claim-alpha"]);
  });

  it("buckets only active claims; superseded/retracted/draft are skipped", async () => {
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-active",
      key: "subject.one",
      status: "active",
      confidence: 0.9,
      profile: ["profile-charmander"],
    });
    await writeClaimFile(vault, {
      id: "claim-superseded",
      key: "subject.two",
      status: "superseded",
      confidence: 0.7,
      profile: ["profile-charmander"],
      superseded_by: "claim-active",
    });
    await writeClaimFile(vault, {
      id: "claim-retracted",
      key: "subject.three",
      status: "retracted",
      confidence: 0.5,
      profile: ["profile-charmander"],
    });
    await writeClaimFile(vault, {
      id: "claim-draft",
      key: "subject.four",
      status: "draft",
      confidence: 0.6,
      profile: ["profile-charmander"],
    });

    await reindex(vault);

    const idx = await readSidecar(vault);
    expect(idx.by_profile["profile-charmander"]).toEqual(["claim-active"]);
    // No bucket should mention the inactive claims under any dimension
    const allIds = new Set<string>([
      ...Object.values(idx.by_profile).flat(),
      ...Object.values(idx.by_move).flat(),
      ...Object.values(idx.by_scope_wiki).flat(),
      ...Object.values(idx.by_tag).flat(),
      ...idx.global,
    ]);
    expect(allIds.has("claim-superseded")).toBe(false);
    expect(allIds.has("claim-retracted")).toBe(false);
    expect(allIds.has("claim-draft")).toBe(false);
  });

  it("tags-only active claims land in global AND in by_tag", async () => {
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-tags-only",
      key: "tag.subject",
      status: "active",
      confidence: 0.9,
      tags: ["frontend", "design"],
    });

    await reindex(vault);

    const idx = await readSidecar(vault);
    // Tags-only is global per spec §5.4
    expect(idx.global).toContain("claim-tags-only");
    expect(idx.by_tag["frontend"]).toEqual(["claim-tags-only"]);
    expect(idx.by_tag["design"]).toEqual(["claim-tags-only"]);
    // No profile/move/scope_wiki bucket
    expect(Object.keys(idx.by_profile)).toHaveLength(0);
    expect(Object.keys(idx.by_move)).toHaveLength(0);
    expect(Object.keys(idx.by_scope_wiki)).toHaveLength(0);
  });

  it("populates by_profile / by_move / by_scope_wiki for non-global active claims", async () => {
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-multi",
      key: "multi.subject",
      status: "active",
      confidence: 0.8,
      profile: ["profile-charmander", "profile-charmeleon"],
      move: ["move-tdd-cycle"],
      scope_wiki: ["alpha"],
      tags: ["coverage"],
    });

    await reindex(vault);

    const idx = await readSidecar(vault);
    expect(idx.by_profile["profile-charmander"]).toEqual(["claim-multi"]);
    expect(idx.by_profile["profile-charmeleon"]).toEqual(["claim-multi"]);
    expect(idx.by_move["move-tdd-cycle"]).toEqual(["claim-multi"]);
    expect(idx.by_scope_wiki["alpha"]).toEqual(["claim-multi"]);
    expect(idx.by_tag["coverage"]).toEqual(["claim-multi"]);
    // Has profile/move/scope_wiki → NOT global
    expect(idx.global).not.toContain("claim-multi");
  });

  it("emits an empty sidecar when no claim files exist anywhere in the vault", async () => {
    const vault = await mkTempVault();
    // No claim files written.

    await reindex(vault);

    const idx = await readSidecar(vault);
    expect(idx.schema_version).toBe(1);
    expect(idx.by_profile).toEqual({});
    expect(idx.by_move).toEqual({});
    expect(idx.by_scope_wiki).toEqual({});
    expect(idx.by_tag).toEqual({});
    expect(idx.global).toEqual([]);
  });

  it("rebuilds the sidecar on scoped reindex and includes claims from other wikis too", async () => {
    const vault = await mkTempVault();
    // Two wikis, each with one active claim.
    await fs.mkdir(join(vault, "wikis", "alpha", "claim"), { recursive: true });
    await writeClaimFile(vault, {
      id: "claim-alpha-side",
      key: "alpha.subject",
      status: "active",
      confidence: 0.9,
      profile: ["profile-charmander"],
      wiki: "alpha",
    });
    await writeClaimFile(vault, {
      id: "claim-agents-side",
      key: "agents.subject",
      status: "active",
      confidence: 0.9,
      profile: ["profile-gastly"],
      wiki: "_agents",
    });

    // Seed: full reindex first so scoped path has an existing index to merge into.
    await reindex(vault);

    // Now scoped to alpha.
    await reindex(vault, "alpha");

    const idx = await readSidecar(vault);
    // Sidecar is built from full disk scan, so both claims should be present.
    expect(idx.by_profile["profile-charmander"]).toEqual(["claim-alpha-side"]);
    expect(idx.by_profile["profile-gastly"]).toEqual(["claim-agents-side"]);
  });
});
