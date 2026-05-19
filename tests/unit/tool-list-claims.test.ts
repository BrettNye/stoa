// vault-mcp/tests/unit/tool-list-claims.test.ts
//
// task-list-claims-tool — covers every Acceptance bullet from
// `wikis/_meta/plans/2026-05-02-vault-mcp-claims-plan-1-foundation-dag.md`
// §task-list-claims-tool:
//
// - by=profile + value sorts by effective confidence descending
// - status=["superseded"] filter returns only superseded
// - min_effective_confidence floor excludes decayed-below claims
// - limit truncates while `total` reflects unfiltered count
// - by=global returns sidecar's `global` array
// - index_age_seconds reflects generated_at age
// - non-existent profile returns empty list, not error
// - render_min_confidence default (0.4) and render_default_limit (10) apply
//   when the caller omits min_effective_confidence / limit
//
// callTool is intentionally NOT used here: registration in tools/index.ts is
// the responsibility of task-tools-index-registration. We test the handler
// directly via the exported `listClaimsTool` object.

import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { listClaimsTool } from "../../src/tools/list-claims.js";
import { mkTempVaultWithSidecar } from "../helpers.js";

const TODAY = new Date("2026-05-02T12:00:00Z");

/**
 * mkTempVaultWithSidecar uses helpers.ts defaults (last_validated:
 * "2026-05-02"). For decay-floor tests we need to override that value to
 * push effective confidence below 0.4. This helper rewrites the on-disk
 * claim file's `last_validated` after creation. (Easier than threading a
 * new override through helpers.ts and avoids changing upstream contract.)
 */
async function setLastValidated(vaultPath: string, claimId: string, iso: string): Promise<void> {
  const file = path.join(vaultPath, "wikis", "_agents", "claim", `${claimId}.md`);
  const raw = await fs.readFile(file, "utf8");
  const out = raw.replace(/last_validated: ".*?"/, `last_validated: ${JSON.stringify(iso)}`);
  await fs.writeFile(file, out, "utf8");
}

describe("vault.list-claims tool", () => {
  it("returns claims sorted by effective confidence descending (by=profile)", async () => {
    // NB (bug-2026-05-19): sidecar buckets are keyed by *bare* agent ids
    // because vault.claim strips `profile-` / `agent:` before storing
    // (src/tools/claim.ts:127). Tests must mirror that storage form, and
    // the query value: filter is normalized the same way.
    const vault = await mkTempVaultWithSidecar([
      { id: "claim-low",  key: "k.a", profile: ["charmander"], confidence: 0.5, status: "active" },
      { id: "claim-high", key: "k.b", profile: ["charmander"], confidence: 0.9, status: "active" },
      { id: "claim-mid",  key: "k.c", profile: ["charmander"], confidence: 0.7, status: "active" },
    ]);
    const out = await listClaimsTool.handler(
      { by: "profile", value: "profile-charmander", min_effective_confidence: 0, status: ["active"], limit: 50 },
      { vaultPath: vault, rawConfig: {}, today: TODAY },
    );
    expect(out.claims.map((c: any) => c.id)).toEqual(["claim-high", "claim-mid", "claim-low"]);
    // Each entry includes effective_confidence, days_since_validated, etc.
    expect(out.claims[0].effective_confidence).toBeCloseTo(0.9, 5);
    expect(out.claims[0].days_since_validated).toBe(0);
    expect(out.claims[0].stored_confidence).toBe(0.9);
  });

  it("filters by status=['superseded']", async () => {
    const vault = await mkTempVaultWithSidecar([
      { id: "claim-active",     key: "k.a", profile: ["p"], confidence: 0.8, status: "active" },
      { id: "claim-superseded", key: "k.b", profile: ["p"], confidence: 0.8, status: "superseded",
        superseded_by: "claim-active" },
    ]);
    const out = await listClaimsTool.handler(
      { status: ["superseded"], min_effective_confidence: 0, limit: 50 },
      { vaultPath: vault, rawConfig: {}, today: TODAY },
    );
    expect(out.claims).toHaveLength(1);
    expect(out.claims[0].id).toBe("claim-superseded");
    expect(out.claims[0].status).toBe("superseded");
  });

  it("excludes claims below min_effective_confidence", async () => {
    const vault = await mkTempVaultWithSidecar([
      { id: "claim-fresh", key: "k.fresh", profile: ["p"], confidence: 0.9, status: "active" },
      { id: "claim-stale", key: "k.stale", profile: ["p"], confidence: 0.9, status: "active" },
    ]);
    // Push claim-stale 200 days back: effective = 0.9 * floor(0.1) = 0.09 < 0.5
    await setLastValidated(vault, "claim-stale", "2025-10-14");
    const out = await listClaimsTool.handler(
      { by: "profile", value: "p", min_effective_confidence: 0.5, status: ["active"], limit: 10 },
      { vaultPath: vault, rawConfig: {}, today: TODAY },
    );
    expect(out.claims).toHaveLength(1);
    expect(out.claims[0].id).toBe("claim-fresh");
  });

  it("truncates results to limit but reports total of unfiltered matches", async () => {
    const vault = await mkTempVaultWithSidecar([
      { id: "claim-1", key: "k.1", profile: ["p"], confidence: 0.9, status: "active" },
      { id: "claim-2", key: "k.2", profile: ["p"], confidence: 0.8, status: "active" },
      { id: "claim-3", key: "k.3", profile: ["p"], confidence: 0.7, status: "active" },
      { id: "claim-4", key: "k.4", profile: ["p"], confidence: 0.6, status: "active" },
      { id: "claim-5", key: "k.5", profile: ["p"], confidence: 0.5, status: "active" },
    ]);
    const out = await listClaimsTool.handler(
      { by: "profile", value: "p", min_effective_confidence: 0, status: ["active"], limit: 3 },
      { vaultPath: vault, rawConfig: {}, today: TODAY },
    );
    expect(out.claims).toHaveLength(3);
    expect(out.total).toBe(5);
    expect(out.claims.map((c: any) => c.id)).toEqual(["claim-1", "claim-2", "claim-3"]);
  });

  it("by=global returns claims from sidecar's global array", async () => {
    const vault = await mkTempVaultWithSidecar([
      { id: "claim-global", key: "k.g", confidence: 0.8, status: "active" /* no profile/move/scope_wiki */ },
      { id: "claim-scoped", key: "k.s", profile: ["p"], confidence: 0.9, status: "active" },
    ]);
    const out = await listClaimsTool.handler(
      { by: "global", min_effective_confidence: 0, status: ["active"], limit: 50 },
      { vaultPath: vault, rawConfig: {}, today: TODAY },
    );
    expect(out.claims).toHaveLength(1);
    expect(out.claims[0].id).toBe("claim-global");
  });

  it("returns index_age_seconds based on sidecar generated_at", async () => {
    const vault = await mkTempVaultWithSidecar([
      { id: "claim-x", key: "k.x", profile: ["p"], confidence: 0.8, status: "active" },
    ]);
    // Backdate the sidecar generated_at by 30s.
    const sidecarPath = path.join(vault, "_index", "claims.json");
    const sidecar = JSON.parse(await fs.readFile(sidecarPath, "utf8"));
    const backdated = new Date(TODAY.getTime() - 30_000).toISOString();
    sidecar.generated_at = backdated;
    await fs.writeFile(sidecarPath, JSON.stringify(sidecar), "utf8");
    const out = await listClaimsTool.handler(
      { min_effective_confidence: 0, status: ["active"], limit: 50 },
      { vaultPath: vault, rawConfig: {}, today: TODAY },
    );
    expect(out.index_age_seconds).toBe(30);
  });

  it("returns empty list (not error) for a non-existent profile", async () => {
    // Storage uses bare agent ids (matches vault.claim) — see bug-2026-05-19
    // notes on the descending-sort test above.
    const vault = await mkTempVaultWithSidecar([
      { id: "claim-x", key: "k.x", profile: ["real"], confidence: 0.8, status: "active" },
    ]);
    const out = await listClaimsTool.handler(
      { by: "profile", value: "profile-ghost", min_effective_confidence: 0, status: ["active"], limit: 50 },
      { vaultPath: vault, rawConfig: {}, today: TODAY },
    );
    expect(out.claims).toEqual([]);
    expect(out.total).toBe(0);
  });

  it("falls back to render defaults: render_min_confidence=0.4 and render_default_limit=10", async () => {
    // 12 claims total: 11 active fresh @ 0.9 (effective 0.9, all above floor),
    // 1 stale (200d old) @ 0.5 → effective 0.05, below 0.4 floor.
    // Default limit is 10 → 10 returned, total reflects 11 (filtered set above floor).
    const claims = [];
    for (let i = 1; i <= 11; i++) {
      claims.push({
        id: `claim-fresh-${String(i).padStart(2, "0")}`,
        key: `k.${i}`,
        profile: ["p"],
        confidence: 0.9,
        status: "active" as const,
      });
    }
    claims.push({ id: "claim-stale", key: "k.stale", profile: ["p"], confidence: 0.5, status: "active" as const });
    const vault = await mkTempVaultWithSidecar(claims);
    await setLastValidated(vault, "claim-stale", "2025-10-14");
    const out = await listClaimsTool.handler(
      { by: "profile", value: "p", status: ["active"] },
      { vaultPath: vault, rawConfig: {}, today: TODAY },
    );
    // 11 fresh pass the 0.4 floor; default limit truncates to 10.
    expect(out.total).toBe(11);
    expect(out.claims).toHaveLength(10);
    expect(out.claims.every((c: any) => c.id.startsWith("claim-fresh"))).toBe(true);
  });

  it("filters by wiki when wiki: arg is provided", async () => {
    const vault = await mkTempVaultWithSidecar([
      { id: "claim-here",  key: "k.h", profile: ["p"], confidence: 0.8, status: "active", wiki: "_agents" },
      { id: "claim-other", key: "k.o", profile: ["p"], confidence: 0.8, status: "active", wiki: "alpha" },
    ]);
    const out = await listClaimsTool.handler(
      { by: "profile", value: "p", min_effective_confidence: 0, status: ["active"], limit: 50, wiki: "_agents" },
      { vaultPath: vault, rawConfig: {}, today: TODAY },
    );
    expect(out.claims).toHaveLength(1);
    expect(out.claims[0].id).toBe("claim-here");
  });

  it("respects vault config overrides for render_min_confidence and render_default_limit", async () => {
    // Fresh, active, all eligible. Override default limit (10 → 2) and floor.
    const claims = [];
    for (let i = 1; i <= 5; i++) {
      claims.push({
        id: `claim-${i}`,
        key: `k.${i}`,
        profile: ["p"],
        confidence: 0.9 - i * 0.05,
        status: "active" as const,
      });
    }
    const vault = await mkTempVaultWithSidecar(claims);
    const out = await listClaimsTool.handler(
      { by: "profile", value: "p", status: ["active"] },
      { vaultPath: vault, rawConfig: { claims: { render_default_limit: 2, render_min_confidence: 0 } }, today: TODAY },
    );
    expect(out.claims).toHaveLength(2);
    // Sorted desc → top 2.
    expect(out.claims.map((c: any) => c.id)).toEqual(["claim-1", "claim-2"]);
  });

  it("by=move + value selects move bucket", async () => {
    const vault = await mkTempVaultWithSidecar([
      { id: "claim-pr", key: "k.pr", move: ["move-pr-create"], confidence: 0.8, status: "active" },
      { id: "claim-other", key: "k.o", move: ["move-tdd-cycle"], confidence: 0.9, status: "active" },
    ]);
    const out = await listClaimsTool.handler(
      { by: "move", value: "move-pr-create", min_effective_confidence: 0, status: ["active"], limit: 50 },
      { vaultPath: vault, rawConfig: {}, today: TODAY },
    );
    expect(out.claims).toHaveLength(1);
    expect(out.claims[0].id).toBe("claim-pr");
  });

  it("by=tag + value selects tag bucket", async () => {
    const vault = await mkTempVaultWithSidecar([
      { id: "claim-bug", key: "k.b", tags: ["bug-class:flaky"], confidence: 0.8, status: "active" },
      { id: "claim-other", key: "k.o", tags: ["other"], confidence: 0.9, status: "active" },
    ]);
    const out = await listClaimsTool.handler(
      { by: "tag", value: "bug-class:flaky", min_effective_confidence: 0, status: ["active"], limit: 50 },
      { vaultPath: vault, rawConfig: {}, today: TODAY },
    );
    expect(out.claims).toHaveLength(1);
    expect(out.claims[0].id).toBe("claim-bug");
  });

  // Regression bug-2026-05-19 (untracked-at-claim) — list-claims did not
  // strip `agent:` or `profile-` prefixes from value:, while vault.claim
  // (src/tools/claim.ts:127) and vault.agent-memory (agent-memory.ts:35-37)
  // both strip those prefixes before storing. Result: a production sidecar
  // with `by_profile["charmander"]` was silently empty when queried with
  // `value: "profile-charmander"`. Fix: normalize value: for by=profile.
  describe("regression bug-2026-05-19: prefix-normalized value: filter", () => {
    it("strips `profile-` prefix from value: when by=profile (matches vault.claim storage)", async () => {
      // Sidecar bucket keyed by bare agent id, matching production behavior
      // (vault.claim strips prefixes before storing).
      const vault = await mkTempVaultWithSidecar([
        { id: "claim-x", key: "k.x", profile: ["charmander"], confidence: 0.8, status: "active" },
      ]);
      const out = await listClaimsTool.handler(
        { by: "profile", value: "profile-charmander", min_effective_confidence: 0, status: ["active"], limit: 50 },
        { vaultPath: vault, rawConfig: {}, today: TODAY },
      );
      expect(out.claims).toHaveLength(1);
      expect(out.claims[0].id).toBe("claim-x");
    });

    it("strips `agent:` prefix from value: when by=profile", async () => {
      const vault = await mkTempVaultWithSidecar([
        { id: "claim-x", key: "k.x", profile: ["charmander"], confidence: 0.8, status: "active" },
      ]);
      const out = await listClaimsTool.handler(
        { by: "profile", value: "agent:charmander", min_effective_confidence: 0, status: ["active"], limit: 50 },
        { vaultPath: vault, rawConfig: {}, today: TODAY },
      );
      expect(out.claims).toHaveLength(1);
      expect(out.claims[0].id).toBe("claim-x");
    });

    it("bare agent-id value: still works (no over-strip)", async () => {
      const vault = await mkTempVaultWithSidecar([
        { id: "claim-x", key: "k.x", profile: ["charmander"], confidence: 0.8, status: "active" },
      ]);
      const out = await listClaimsTool.handler(
        { by: "profile", value: "charmander", min_effective_confidence: 0, status: ["active"], limit: 50 },
        { vaultPath: vault, rawConfig: {}, today: TODAY },
      );
      expect(out.claims).toHaveLength(1);
      expect(out.claims[0].id).toBe("claim-x");
    });

    it("does NOT strip prefixes for by=tag (raw bucket keys)", async () => {
      // Tag buckets use raw values — never strip.
      const vault = await mkTempVaultWithSidecar([
        { id: "claim-x", key: "k.x", tags: ["agent:something"], confidence: 0.8, status: "active" },
      ]);
      const out = await listClaimsTool.handler(
        { by: "tag", value: "agent:something", min_effective_confidence: 0, status: ["active"], limit: 50 },
        { vaultPath: vault, rawConfig: {}, today: TODAY },
      );
      expect(out.claims).toHaveLength(1);
      expect(out.claims[0].id).toBe("claim-x");
    });
  });

  it("by=scope_wiki + value selects scope_wiki bucket", async () => {
    const vault = await mkTempVaultWithSidecar([
      { id: "claim-alpha", key: "k.a", scope_wiki: ["alpha"], confidence: 0.8, status: "active" },
      { id: "claim-beta",  key: "k.b", scope_wiki: ["beta"],  confidence: 0.9, status: "active" },
    ]);
    const out = await listClaimsTool.handler(
      { by: "scope_wiki", value: "alpha", min_effective_confidence: 0, status: ["active"], limit: 50 },
      { vaultPath: vault, rawConfig: {}, today: TODAY },
    );
    expect(out.claims).toHaveLength(1);
    expect(out.claims[0].id).toBe("claim-alpha");
  });

  it("returns full per-claim shape per spec §7.1", async () => {
    const vault = await mkTempVaultWithSidecar([
      { id: "claim-shape", key: "k.shape", profile: ["p"], move: ["m1"], scope_wiki: ["alpha"], tags: ["t1"],
        confidence: 0.8, status: "active", evidence: ["[[wikis/alpha/journal/j1]]"], authored_by: "agent:test" },
    ]);
    const out = await listClaimsTool.handler(
      { by: "profile", value: "p", min_effective_confidence: 0, status: ["active"], limit: 50 },
      { vaultPath: vault, rawConfig: {}, today: TODAY },
    );
    expect(out.claims).toHaveLength(1);
    const c = out.claims[0];
    expect(c.id).toBe("claim-shape");
    expect(c.key).toBe("k.shape");
    expect(c.profile).toEqual(["p"]);
    expect(c.move).toEqual(["m1"]);
    expect(c.scope_wiki).toEqual(["alpha"]);
    expect(c.tags).toEqual(["t1"]);
    expect(c.stored_confidence).toBe(0.8);
    expect(c.effective_confidence).toBeCloseTo(0.8, 5);
    expect(c.days_since_validated).toBe(0);
    expect(c.authored_by).toBe("agent:test");
    expect(c.evidence).toEqual(["[[wikis/alpha/journal/j1]]"]);
    expect(c.status).toBe("active");
    expect(c.supersedes).toEqual([]);
    expect(c.title).toBeDefined();
    expect(c.body).toBeDefined();
    expect(c.last_validated).toBe("2026-05-02");
  });
});
