// Tests for the corpus-wide claim-key-collision lint rule.
//
// Two ACTIVE claims sharing the same identity tuple `(key, scope_hash)` are
// a collision. The vault.claim write path prevents this; the rule catches
// hand-edited files and git-merge artifacts.
//
// Plan reference: wikis/_meta/plans/2026-05-02-vault-mcp-claims-plan-1-
// foundation-dag.md §task-lint-key-collision.
//
// Adapted to the existing `LintCheck { code, run(ctx, idx, input) }`
// interface (see src/core/lint-check.ts). The module exports a pure helper
// `findClaimKeyCollisions(claims)` so unit tests can drive the rule with
// in-memory `makePage` stubs (per the plan template) without spinning up
// a real vault on disk. Disk integration is exercised via the registered
// `LintCheck.run` path, which uses `parseFrontmatter` + `idx.pages`.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLAIM_KEY_COLLISION_CODE,
  findClaimKeyCollisions,
} from "../../src/core/lint-checks/claim-key-collision.js";
import { lintCheckRegistry } from "../../src/core/lint-check.js";
import { makePage, writeClaimFile, mkTempVault } from "../helpers.js";
import type { VaultIndex, IndexedPage } from "../../src/core/index.js";
import "../../src/core/lint-checks/claim-key-collision.js";

function activeClaim(overrides: Record<string, unknown>): ReturnType<typeof makePage> {
  return makePage({
    id: "claim-x",
    type: "claim",
    status: "active",
    key: "test.x",
    profile: [],
    move: [],
    scope_wiki: [],
    tags: [],
    ...overrides,
  });
}

describe("findClaimKeyCollisions (pure helper)", () => {
  it("warns when two active claims share identity tuple (same key, same scope)", () => {
    const a = activeClaim({ id: "claim-a", key: "x.y", profile: ["p"] });
    const b = activeClaim({ id: "claim-b", key: "x.y", profile: ["p"] });
    const findings = findClaimKeyCollisions([a, b]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].code).toBe(CLAIM_KEY_COLLISION_CODE);
    expect(findings[0].message).toContain("claim-a");
    expect(findings[0].message).toContain("claim-b");
  });

  it("does NOT trigger when same key but different scope_hash (different tags)", () => {
    const a = activeClaim({ id: "claim-a", key: "x.y", tags: ["alpha"] });
    const b = activeClaim({ id: "claim-b", key: "x.y", tags: ["beta"] });
    const findings = findClaimKeyCollisions([a, b]);
    expect(findings).toHaveLength(0);
  });

  it("does NOT trigger when same key but different scope_wiki", () => {
    const a = activeClaim({ id: "claim-a", key: "x.y", scope_wiki: ["w1"] });
    const b = activeClaim({ id: "claim-b", key: "x.y", scope_wiki: ["w2"] });
    expect(findClaimKeyCollisions([a, b])).toHaveLength(0);
  });

  it("does NOT trigger when same scope but different key", () => {
    const a = activeClaim({ id: "claim-a", key: "x.y", profile: ["p"] });
    const b = activeClaim({ id: "claim-b", key: "x.z", profile: ["p"] });
    expect(findClaimKeyCollisions([a, b])).toHaveLength(0);
  });

  it("warns once when three active claims share identity tuple, naming all three ids", () => {
    const a = activeClaim({ id: "claim-a", key: "x.y", move: ["m"] });
    const b = activeClaim({ id: "claim-b", key: "x.y", move: ["m"] });
    const c = activeClaim({ id: "claim-c", key: "x.y", move: ["m"] });
    const findings = findClaimKeyCollisions([a, b, c]);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("claim-a");
    expect(findings[0].message).toContain("claim-b");
    expect(findings[0].message).toContain("claim-c");
  });

  it("does NOT trigger when one claim is superseded (only active-vs-active counts)", () => {
    const a = activeClaim({ id: "claim-a", key: "x.y", profile: ["p"] });
    const b = activeClaim({
      id: "claim-b",
      key: "x.y",
      profile: ["p"],
      status: "superseded",
      superseded_by: "claim-a",
    });
    expect(findClaimKeyCollisions([a, b])).toHaveLength(0);
  });

  it("does NOT trigger when one claim is retracted", () => {
    const a = activeClaim({ id: "claim-a", key: "x.y", profile: ["p"] });
    const b = activeClaim({
      id: "claim-b",
      key: "x.y",
      profile: ["p"],
      status: "retracted",
    });
    expect(findClaimKeyCollisions([a, b])).toHaveLength(0);
  });

  it("does NOT trigger when one claim is draft", () => {
    const a = activeClaim({ id: "claim-a", key: "x.y", profile: ["p"] });
    const b = activeClaim({
      id: "claim-b",
      key: "x.y",
      profile: ["p"],
      status: "draft",
    });
    expect(findClaimKeyCollisions([a, b])).toHaveLength(0);
  });

  it("returns no findings on empty input", () => {
    expect(findClaimKeyCollisions([])).toHaveLength(0);
  });

  it("ignores non-claim pages mixed in", () => {
    const claim = activeClaim({ id: "claim-a", key: "x.y", profile: ["p"] });
    const note = makePage({ id: "concept-x", type: "concept", status: "active" });
    expect(findClaimKeyCollisions([claim, note])).toHaveLength(0);
  });

  it("treats arrays as order-independent (scope hash sorts internally)", () => {
    const a = activeClaim({ id: "claim-a", key: "x.y", profile: ["p1", "p2"], tags: ["t1", "t2"] });
    const b = activeClaim({ id: "claim-b", key: "x.y", profile: ["p2", "p1"], tags: ["t2", "t1"] });
    expect(findClaimKeyCollisions([a, b])).toHaveLength(1);
  });
});

describe("claim-key-collision (registered LintCheck on disk)", () => {
  const KEY = "CLAIM_KEY_COLLISION";

  it("registers under the expected code", () => {
    const reg = lintCheckRegistry.find(c => c.code === KEY);
    expect(reg).toBeDefined();
  });

  it("flags two on-disk active claims that share identity tuple", async () => {
    const vault = await mkTempVault();
    try {
      await writeClaimFile(vault, {
        id: "claim-disk-a", key: "disk.x", status: "active", confidence: 0.6,
        profile: ["p"], authored_by: "agent:t",
      });
      await writeClaimFile(vault, {
        id: "claim-disk-b", key: "disk.x", status: "active", confidence: 0.6,
        profile: ["p"], authored_by: "agent:t",
      });

      const reg = lintCheckRegistry.find(c => c.code === KEY)!;
      const idx: VaultIndex = {
        wikis: [{ name: "_agents", mode: "mixed", scope: "", page_counts: {}, last_touched: "" }],
        pages: [
          {
            id: "claim-disk-a", type: "claim" as const, wiki: "_agents", title: "claim-disk-a",
            summary: "", tags: [], status: "active" as const, updated: "2026-05-02",
            created: "2026-05-02", path: "wikis/_agents/claim/claim-disk-a.md",
          } as IndexedPage,
          {
            id: "claim-disk-b", type: "claim" as const, wiki: "_agents", title: "claim-disk-b",
            summary: "", tags: [], status: "active" as const, updated: "2026-05-02",
            created: "2026-05-02", path: "wikis/_agents/claim/claim-disk-b.md",
          } as IndexedPage,
        ],
        links: {},
      };

      const diagnostics = reg.run({ vaultPath: vault }, idx, {});
      const ours = diagnostics.filter(d => d.code === KEY);
      expect(ours).toHaveLength(1);
      expect(ours[0].message).toContain("claim-disk-a");
      expect(ours[0].message).toContain("claim-disk-b");
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  });

  it("does not flag a single active claim", async () => {
    const vault = await mkTempVault();
    try {
      await writeClaimFile(vault, {
        id: "claim-solo", key: "solo.x", status: "active", confidence: 0.6,
        profile: ["p"], authored_by: "agent:t",
      });

      const reg = lintCheckRegistry.find(c => c.code === KEY)!;
      const idx: VaultIndex = {
        wikis: [{ name: "_agents", mode: "mixed", scope: "", page_counts: {}, last_touched: "" }],
        pages: [
          {
            id: "claim-solo", type: "claim" as const, wiki: "_agents", title: "claim-solo",
            summary: "", tags: [], status: "active" as const, updated: "2026-05-02",
            created: "2026-05-02", path: "wikis/_agents/claim/claim-solo.md",
          } as IndexedPage,
        ],
        links: {},
      };

      const diagnostics = reg.run({ vaultPath: vault }, idx, {});
      const ours = diagnostics.filter(d => d.code === KEY);
      expect(ours).toHaveLength(0);
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  });
});
