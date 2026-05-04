import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import "../../src/core/lint-checks/claim-effective-below-floor.js";
import { lintCheckRegistry } from "../../src/core/lint-check.js";
import type { LintCheck } from "../../src/core/lint-check.js";
import type { VaultIndex } from "../../src/core/index.js";
import { mkTempVault, writeClaimFile } from "../helpers.js";

// CLAIM_EFFECTIVE_BELOW_FLOOR (severity:info) — task-lint-below-floor.
//
// Walks every `wikis/<name>/claim/*.md`, computes effectiveConfidence using
// an injected `today`, and emits one info-level diagnostic per active claim
// whose effective confidence has decayed below the configured render-floor
// (`claims.render_min_confidence`, default 0.4 per spec §6.2). Non-active
// claims are skipped — superseded/retracted claims aren't actionable signal
// for this check (effectiveConfidence already returns 0 for those, but the
// "this needs revalidation" advice doesn't apply to a deliberately-closed
// lifecycle state).
//
// `today` is injected via LintCheckCtx so tests are deterministic and never
// depend on wall-clock time. Production callers may omit it; the check then
// defaults to `new Date()` at run time. This mirrors the contract of
// `effectiveConfidence(claim, today, config)` itself.

const emptyIdx: VaultIndex = { wikis: [], pages: [], links: {} };

function getCheck(): LintCheck {
  const c = lintCheckRegistry.find(x => x.code === "CLAIM_EFFECTIVE_BELOW_FLOOR");
  if (!c) throw new Error("CLAIM_EFFECTIVE_BELOW_FLOOR not registered");
  return c;
}

describe("CLAIM_EFFECTIVE_BELOW_FLOOR — registration", () => {
  it("is registered exactly once on import", () => {
    const matches = lintCheckRegistry.filter(c => c.code === "CLAIM_EFFECTIVE_BELOW_FLOOR");
    expect(matches.length).toBe(1);
  });

  it("re-importing the module is idempotent", async () => {
    const before = lintCheckRegistry.filter(c => c.code === "CLAIM_EFFECTIVE_BELOW_FLOOR").length;
    await import("../../src/core/lint-checks/claim-effective-below-floor.js");
    const after = lintCheckRegistry.filter(c => c.code === "CLAIM_EFFECTIVE_BELOW_FLOOR").length;
    expect(after).toBe(before);
  });
});

describe("CLAIM_EFFECTIVE_BELOW_FLOOR — empty / absent inputs", () => {
  let vault: string;

  beforeEach(async () => {
    vault = await mkTempVault();
  });

  afterEach(() => {
    if (vault) rmSync(vault, { recursive: true, force: true });
  });

  it("returns no diagnostics on a vault with no claim files", () => {
    const out = getCheck().run({ vaultPath: vault, today: new Date("2026-05-02T00:00:00Z") }, emptyIdx, {});
    expect(out).toEqual([]);
  });

  it("returns no diagnostics when vault has no wikis directory at all", () => {
    const noWikisVault = join(vault, "..", "no-such-vault-" + Math.random());
    const out = getCheck().run({ vaultPath: noWikisVault, today: new Date("2026-05-02T00:00:00Z") }, emptyIdx, {});
    expect(out).toEqual([]);
  });
});

describe("CLAIM_EFFECTIVE_BELOW_FLOOR — active claim threshold semantics", () => {
  let vault: string;

  beforeEach(async () => {
    vault = await mkTempVault();
  });

  afterEach(() => {
    if (vault) rmSync(vault, { recursive: true, force: true });
  });

  it("does NOT flag a freshly-validated active claim well above the floor", async () => {
    await writeClaimFile(vault, {
      id: "claim-fresh",
      key: "test.fresh",
      status: "active",
      confidence: 0.8,
      last_validated: "2026-05-02",
    });
    const today = new Date("2026-05-02T00:00:00Z"); // same day
    const out = getCheck().run({ vaultPath: vault, today }, emptyIdx, {});
    const ours = out.filter(d => d.code === "CLAIM_EFFECTIVE_BELOW_FLOOR");
    expect(ours).toEqual([]);
  });

  it("does NOT flag an active claim exactly at the render floor (0.4)", async () => {
    // confidence 0.8 at 75-day half-life → effective ≈ 0.4.
    await writeClaimFile(vault, {
      id: "claim-at-floor",
      key: "test.atfloor",
      status: "active",
      confidence: 0.8,
      last_validated: "2026-05-02",
    });
    const today = new Date("2026-07-16T00:00:00Z"); // 75 days later
    const out = getCheck().run({ vaultPath: vault, today }, emptyIdx, {});
    const ours = out.filter(d => d.code === "CLAIM_EFFECTIVE_BELOW_FLOOR" && d.page_id === "claim-at-floor");
    // 0.4 is the floor; "below" is strict. At equals → no diagnostic.
    expect(ours).toEqual([]);
  });

  it("flags an active claim that has decayed below the render floor", async () => {
    // 200 days at half-life 75 with effective_floor 0.1 → effective = 0.08 (clamped).
    await writeClaimFile(vault, {
      id: "claim-stale",
      key: "test.stale",
      status: "active",
      confidence: 0.8,
      last_validated: "2026-05-02",
    });
    const today = new Date("2026-11-18T00:00:00Z"); // 200 days later
    const out = getCheck().run({ vaultPath: vault, today }, emptyIdx, {});
    const ours = out.filter(d => d.code === "CLAIM_EFFECTIVE_BELOW_FLOOR" && d.page_id === "claim-stale");
    expect(ours).toHaveLength(1);
    expect(ours[0].severity).toBe("info");
    expect(ours[0].wiki).toBe("_agents");
    expect(ours[0].suggestion).toBeDefined();
  });

  it("emits one diagnostic per below-floor claim across multiple files", async () => {
    await writeClaimFile(vault, {
      id: "claim-stale-1",
      key: "test.stale1",
      status: "active",
      confidence: 0.8,
      last_validated: "2026-05-02",
    });
    await writeClaimFile(vault, {
      id: "claim-stale-2",
      key: "test.stale2",
      status: "active",
      confidence: 0.5,
      last_validated: "2026-05-02",
    });
    // Validated on the SAME day as `today` → effective = stored = 0.9 (≥ floor).
    await writeClaimFile(vault, {
      id: "claim-fresh",
      key: "test.fresh",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-11-18",
    });
    const today = new Date("2026-11-18T00:00:00Z"); // 200 days after the two stale claims
    const out = getCheck().run({ vaultPath: vault, today }, emptyIdx, {});
    const ours = out.filter(d => d.code === "CLAIM_EFFECTIVE_BELOW_FLOOR");
    const ids = ours.map(d => d.page_id).sort();
    expect(ids).toEqual(["claim-stale-1", "claim-stale-2"]);
  });
});

describe("CLAIM_EFFECTIVE_BELOW_FLOOR — non-active statuses are skipped", () => {
  let vault: string;

  beforeEach(async () => {
    vault = await mkTempVault();
  });

  afterEach(() => {
    if (vault) rmSync(vault, { recursive: true, force: true });
  });

  it("does NOT flag a superseded claim regardless of decay", async () => {
    await writeClaimFile(vault, {
      id: "claim-superseded",
      key: "test.sup",
      status: "superseded",
      confidence: 0.8,
      last_validated: "2026-05-02",
      superseded_by: "claim-newer",
    });
    const today = new Date("2026-11-18T00:00:00Z");
    const out = getCheck().run({ vaultPath: vault, today }, emptyIdx, {});
    const ours = out.filter(d => d.code === "CLAIM_EFFECTIVE_BELOW_FLOOR");
    expect(ours).toEqual([]);
  });

  it("does NOT flag a retracted claim regardless of decay", async () => {
    await writeClaimFile(vault, {
      id: "claim-retracted",
      key: "test.ret",
      status: "retracted",
      confidence: 0.8,
      last_validated: "2026-05-02",
    });
    const today = new Date("2026-11-18T00:00:00Z");
    const out = getCheck().run({ vaultPath: vault, today }, emptyIdx, {});
    const ours = out.filter(d => d.code === "CLAIM_EFFECTIVE_BELOW_FLOOR");
    expect(ours).toEqual([]);
  });

  it("does NOT flag a draft claim", async () => {
    await writeClaimFile(vault, {
      id: "claim-draft",
      key: "test.draft",
      status: "draft",
      confidence: 0.8,
      last_validated: "2026-05-02",
    });
    const today = new Date("2026-11-18T00:00:00Z");
    const out = getCheck().run({ vaultPath: vault, today }, emptyIdx, {});
    const ours = out.filter(d => d.code === "CLAIM_EFFECTIVE_BELOW_FLOOR");
    expect(ours).toEqual([]);
  });
});

describe("CLAIM_EFFECTIVE_BELOW_FLOOR — multi-wiki coverage", () => {
  let vault: string;

  beforeEach(async () => {
    vault = await mkTempVault();
  });

  afterEach(() => {
    if (vault) rmSync(vault, { recursive: true, force: true });
  });

  it("scans claims across multiple wikis (not just _agents)", async () => {
    await writeClaimFile(vault, {
      id: "claim-other",
      key: "test.other",
      status: "active",
      confidence: 0.8,
      last_validated: "2026-05-02",
      wiki: "alpha",
    });
    const today = new Date("2026-11-18T00:00:00Z"); // 200 days later → below floor
    const out = getCheck().run({ vaultPath: vault, today }, emptyIdx, {});
    const ours = out.filter(d => d.code === "CLAIM_EFFECTIVE_BELOW_FLOOR" && d.page_id === "claim-other");
    expect(ours).toHaveLength(1);
    expect(ours[0].wiki).toBe("alpha");
  });
});

describe("CLAIM_EFFECTIVE_BELOW_FLOOR — robustness", () => {
  let vault: string;

  beforeEach(async () => {
    vault = await mkTempVault();
  });

  afterEach(() => {
    if (vault) rmSync(vault, { recursive: true, force: true });
  });

  it("skips malformed claim files without throwing", async () => {
    // Write a real claim and a junk file in the same directory.
    await writeClaimFile(vault, {
      id: "claim-good",
      key: "test.good",
      status: "active",
      confidence: 0.8,
      last_validated: "2026-05-02",
    });
    const claimDir = join(vault, "wikis", "_agents", "claim");
    writeFileSync(join(claimDir, "claim-broken.md"), "not yaml at all\n", "utf8");
    const today = new Date("2026-11-18T00:00:00Z"); // 200 days
    const out = getCheck().run({ vaultPath: vault, today }, emptyIdx, {});
    const ours = out.filter(d => d.code === "CLAIM_EFFECTIVE_BELOW_FLOOR");
    // Only the well-formed claim contributes a diagnostic.
    expect(ours.map(d => d.page_id)).toEqual(["claim-good"]);
  });

  it("falls back to new Date() when ctx.today is omitted (production path)", async () => {
    // We can't assert exact wall-clock behavior, but we can confirm the check
    // does not throw and returns an array.
    await writeClaimFile(vault, {
      id: "claim-no-today",
      key: "test.notoday",
      status: "active",
      confidence: 0.8,
      last_validated: "2026-05-02",
    });
    const out = getCheck().run({ vaultPath: vault }, emptyIdx, {});
    expect(Array.isArray(out)).toBe(true);
  });
});
