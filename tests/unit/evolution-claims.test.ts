// vault-mcp/tests/unit/evolution-claims.test.ts
//
// Unit tests for the three pure-ish helpers used only by the evolution
// orchestrator (Claims Plan 2 §task-evolution-claims-helpers):
//   - computeEligibility — threshold check, no I/O
//   - suggestMoves       — reads SKILL.md frontmatter from a temp vault tree
//   - renderRationale    — pure string formatter, fully deterministic
//
// Hermetic: every filesystem fixture is built under `os.tmpdir()` via
// `mkdtempSync`. No live-vault paths are touched.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  computeEligibility,
  suggestMoves,
  renderRationale,
  type RationaleInput,
  type EligibilityReport,
} from "../../src/core/evolution-claims.js";
import type { ParsedClaim } from "../../src/core/claims.js";

// Build a minimal ParsedClaim for clustering input. The live `ParsedClaim`
// shape (vault-mcp/src/core/claims.ts) spreads frontmatter fields directly
// onto the object — there is no `.frontmatter` sub-object — so the helper
// reads `c.id` / `c.confidence` directly. The spec's reference impl wrote
// `c.frontmatter.id` which does not match the live shape; the test exercises
// the live shape (per the spec's "verify against live code before copying"
// instruction).
function fakeClaim(overrides: {
  id: string;
  confidence: number;
  tags?: string[];
}): ParsedClaim {
  return {
    id: overrides.id,
    type: "claim",
    title: overrides.id,
    created: "2026-05-02",
    key: "test.key",
    confidence: overrides.confidence,
    last_validated: "2026-05-02",
    profile: ["profile-charmander"],
    move: [],
    scope_wiki: [],
    tags: overrides.tags ?? [],
    evidence: [],
    status: "active",
    supersedes: [],
    superseded_by: null,
    retracted_at: null,
    retracted_by: null,
    retraction_reason: null,
    wiki: "_agents",
    summary: "test",
    updated: "2026-05-02",
    authored_by: "agent:test",
    body: "",
    filePath: "/fake/path",
    mtime: "2026-05-02T00:00:00.000Z",
  };
}

// ---------- computeEligibility ----------

describe("computeEligibility", () => {
  const thresholds = { stage1: 10, stage2: 25 };

  it("flags ineligible when below stage1 threshold", () => {
    const r = computeEligibility(6, "basic", thresholds);
    expect(r.eligible).toBe(false);
    expect(r.reason).toContain("needs >=10");
    expect(r.threshold).toBe(10);
    expect(r.high_confidence_claim_count).toBe(6);
  });

  it("flags eligible at exactly stage1 threshold", () => {
    const r = computeEligibility(10, "basic", thresholds);
    expect(r.eligible).toBe(true);
    expect(r.threshold).toBe(10);
    expect(r.high_confidence_claim_count).toBe(10);
    expect(r.reason).toContain("10 >= 10");
  });

  it("flags eligible above stage1 threshold for basic", () => {
    const r = computeEligibility(15, "basic", thresholds);
    expect(r.eligible).toBe(true);
  });

  it("flags eligible at exactly stage2 threshold for stage1", () => {
    const r = computeEligibility(25, "stage1", thresholds);
    expect(r.eligible).toBe(true);
    expect(r.threshold).toBe(25);
  });

  it("flags ineligible at stage1 below stage2 threshold", () => {
    const r = computeEligibility(20, "stage1", thresholds);
    expect(r.eligible).toBe(false);
    expect(r.reason).toContain("needs >=25");
    expect(r.threshold).toBe(25);
  });

  it("returns not-eligible at stage2 with explanation", () => {
    const r = computeEligibility(50, "stage2", thresholds);
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/no further evolution/);
    expect(r.high_confidence_claim_count).toBe(50);
    expect(r.threshold).toBe(0);
  });

  it("includes the current stage in the reason for non-stage2 cases", () => {
    expect(computeEligibility(6, "basic", thresholds).reason).toContain("basic");
    expect(computeEligibility(20, "stage1", thresholds).reason).toContain("stage1");
  });
});

// ---------- suggestMoves ----------

describe("suggestMoves", () => {
  let vault: string;

  beforeEach(() => {
    vault = mkdtempSync(path.join(tmpdir(), "evolution-claims-test-"));
  });

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
  });

  async function writeMoveSkill(
    moveId: string,
    fm: { tags?: string[]; applies_to?: string[] }
  ): Promise<void> {
    const dir = path.join(vault, "wikis", "_agents", "moves", moveId);
    await fs.mkdir(dir, { recursive: true });
    const yaml = [
      `id: ${moveId}`,
      `type: move`,
      `title: ${moveId}`,
      fm.tags ? `tags: ${JSON.stringify(fm.tags)}` : "",
      fm.applies_to ? `applies_to: ${JSON.stringify(fm.applies_to)}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    await fs.writeFile(
      path.join(dir, "SKILL.md"),
      `---\n${yaml}\n---\n\nbody\n`,
      "utf8"
    );
  }

  it("returns no suggestion for a cluster whose tag is in a moveset member's `tags`", async () => {
    await writeMoveSkill("move-windows-handler", { tags: ["windows"] });
    const clusters = new Map<string, ParsedClaim[]>([
      ["windows", [fakeClaim({ id: "claim-1", confidence: 0.9 })]],
    ]);
    const out = await suggestMoves(clusters, ["move-windows-handler"], vault);
    expect(out).toHaveLength(0);
  });

  it("returns no suggestion when the tag is in `applies_to` instead of `tags`", async () => {
    await writeMoveSkill("move-x", { applies_to: ["powershell"] });
    const clusters = new Map<string, ParsedClaim[]>([
      ["powershell", [fakeClaim({ id: "claim-1", confidence: 0.9 })]],
    ]);
    const out = await suggestMoves(clusters, ["move-x"], vault);
    expect(out).toHaveLength(0);
  });

  it("emits one suggestion per uncovered cluster with hint, tag, count, and example ids", async () => {
    await writeMoveSkill("move-x", { tags: ["something-else"] });
    const clusters = new Map<string, ParsedClaim[]>([
      [
        "powershell",
        [
          fakeClaim({ id: "claim-a", confidence: 0.9 }),
          fakeClaim({ id: "claim-b", confidence: 0.95 }),
          fakeClaim({ id: "claim-c", confidence: 0.5 }),
        ],
      ],
    ]);
    const out = await suggestMoves(clusters, ["move-x"], vault);
    expect(out).toHaveLength(1);
    expect(out[0].move_hint).toBe("move-powershell-handler");
    expect(out[0].tag_cluster).toEqual(["powershell"]);
    expect(out[0].claim_count).toBe(3);
    // Sorted by stored confidence desc: 0.95, 0.9, 0.5
    expect(out[0].example_claim_ids).toEqual(["claim-b", "claim-a", "claim-c"]);
  });

  it("caps example_claim_ids at 3 entries even with many claims in a cluster", async () => {
    const claims = Array.from({ length: 7 }, (_, i) =>
      fakeClaim({ id: `claim-${i}`, confidence: 0.5 + i * 0.05 })
    );
    const clusters = new Map<string, ParsedClaim[]>([["topic", claims]]);
    const out = await suggestMoves(clusters, [], vault);
    expect(out[0].example_claim_ids).toHaveLength(3);
    // Highest three confidences: claim-6 (0.80), claim-5 (0.75), claim-4 (0.70)
    expect(out[0].example_claim_ids).toEqual(["claim-6", "claim-5", "claim-4"]);
  });

  it("treats a missing SKILL.md as covering nothing (uncovered)", async () => {
    // Note: no writeMoveSkill call — the path simply doesn't exist.
    const clusters = new Map<string, ParsedClaim[]>([
      ["powershell", [fakeClaim({ id: "claim-1", confidence: 0.9 })]],
    ]);
    const out = await suggestMoves(clusters, ["move-ghost"], vault);
    expect(out).toHaveLength(1);
    expect(out[0].move_hint).toBe("move-powershell-handler");
  });

  it("treats a malformed SKILL.md as covering nothing (uncovered)", async () => {
    const dir = path.join(vault, "wikis", "_agents", "moves", "move-broken");
    await fs.mkdir(dir, { recursive: true });
    // Write a file with no frontmatter at all — gray-matter returns data:{}.
    await fs.writeFile(path.join(dir, "SKILL.md"), "no frontmatter here", "utf8");
    const clusters = new Map<string, ParsedClaim[]>([
      ["powershell", [fakeClaim({ id: "claim-1", confidence: 0.9 })]],
    ]);
    const out = await suggestMoves(clusters, ["move-broken"], vault);
    expect(out).toHaveLength(1);
  });

  it("suppresses cluster only if ANY moveset member covers it (union behavior)", async () => {
    await writeMoveSkill("move-a", { tags: ["unrelated"] });
    await writeMoveSkill("move-b", { tags: ["powershell"] });
    const clusters = new Map<string, ParsedClaim[]>([
      ["powershell", [fakeClaim({ id: "claim-1", confidence: 0.9 })]],
    ]);
    const out = await suggestMoves(clusters, ["move-a", "move-b"], vault);
    expect(out).toHaveLength(0);
  });

  it("emits suggestions for multiple uncovered clusters", async () => {
    await writeMoveSkill("move-a", { tags: ["covered-tag"] });
    const clusters = new Map<string, ParsedClaim[]>([
      ["windows", [fakeClaim({ id: "c1", confidence: 0.9 })]],
      ["macos", [fakeClaim({ id: "c2", confidence: 0.8 })]],
      ["covered-tag", [fakeClaim({ id: "c3", confidence: 0.95 })]],
    ]);
    const out = await suggestMoves(clusters, ["move-a"], vault);
    expect(out).toHaveLength(2);
    const hints = out.map((s) => s.move_hint).sort();
    expect(hints).toEqual(["move-macos-handler", "move-windows-handler"]);
  });

  it("returns empty when there are no clusters", async () => {
    const out = await suggestMoves(new Map(), [], vault);
    expect(out).toEqual([]);
  });

  it("returns suggestions when moveset is empty (everything uncovered)", async () => {
    const clusters = new Map<string, ParsedClaim[]>([
      ["x", [fakeClaim({ id: "c1", confidence: 0.5 })]],
    ]);
    const out = await suggestMoves(clusters, [], vault);
    expect(out).toHaveLength(1);
    expect(out[0].move_hint).toBe("move-x-handler");
  });
});

// ---------- renderRationale ----------

describe("renderRationale", () => {
  function baseInput(overrides: Partial<RationaleInput> = {}): RationaleInput {
    const eligibility: EligibilityReport = {
      eligible: false,
      reason: "needs >=10 high-confidence claims for basic, has 6",
      high_confidence_claim_count: 6,
      threshold: 10,
    };
    return {
      profileId: "profile-charmander",
      totalActive: 12,
      aboveThreshold: 6,
      renderMinConfidence: 0.4,
      eligibility,
      currentStage: "basic",
      topClusters: [],
      uncoveredMoveHints: [],
      topEvidenceClaimIds: [],
      ...overrides,
    };
  }

  it("is fully deterministic — same input yields the same string", () => {
    const a = renderRationale(baseInput());
    const b = renderRationale(baseInput());
    expect(a).toBe(b);
  });

  it("renders the profile/totals/threshold/eligibility header line", () => {
    const out = renderRationale(baseInput());
    expect(out).toContain("profile-charmander");
    expect(out).toContain("12 active claims");
    expect(out).toContain("6 exceed the 0.4");
    expect(out).toContain("not eligible");
    expect(out).toContain("basic");
  });

  it("renders 'eligible' (not 'not eligible') when eligibility.eligible is true", () => {
    const out = renderRationale(
      baseInput({
        eligibility: {
          eligible: true,
          reason: "10 >= 10 high-confidence claims for basic",
          high_confidence_claim_count: 10,
          threshold: 10,
        },
      })
    );
    expect(out).toContain("eligible");
    expect(out).not.toContain("not eligible");
  });

  it("renders top tag clusters when present", () => {
    const out = renderRationale(
      baseInput({
        topClusters: [
          { tag: "windows", count: 8 },
          { tag: "powershell", count: 5 },
        ],
      })
    );
    expect(out).toContain("Top tag clusters: windows (8), powershell (5).");
  });

  it("omits the cluster line when topClusters is empty", () => {
    const out = renderRationale(baseInput({ topClusters: [] }));
    expect(out).not.toMatch(/Top tag clusters/);
  });

  it("renders the consider-authoring sentence iff uncoveredMoveHints non-empty", () => {
    const withHints = renderRationale(
      baseInput({ uncoveredMoveHints: ["move-windows-handler"] })
    );
    expect(withHints).toContain("not yet covered");
    expect(withHints).toContain("move-windows-handler");

    const without = renderRationale(baseInput({ uncoveredMoveHints: [] }));
    expect(without).not.toMatch(/not yet covered/);
    expect(without).not.toMatch(/consider authoring/);
  });

  it("joins multiple uncovered move hints with comma-space", () => {
    const out = renderRationale(
      baseInput({
        uncoveredMoveHints: ["move-a-handler", "move-b-handler"],
      })
    );
    expect(out).toContain("move-a-handler, move-b-handler");
  });

  it("cites top evidence claim ids as wikilinks, not raw ids", () => {
    const out = renderRationale(
      baseInput({
        topEvidenceClaimIds: ["claim-x", "claim-y", "claim-z"],
      })
    );
    expect(out).toContain("[[claim-x]], [[claim-y]], [[claim-z]]");
    expect(out).toContain("Top evidence:");
    // Raw id should not appear bare anywhere outside the wikilink brackets.
    expect(out).not.toMatch(/(?<!\[\[)claim-x(?!\]\])/);
  });

  it("omits the evidence line when topEvidenceClaimIds is empty", () => {
    const out = renderRationale(baseInput({ topEvidenceClaimIds: [] }));
    expect(out).not.toMatch(/Top evidence/);
  });

  it("decouples cluster line from consider-authoring line: hints alone (no clusters) still emits the hint sentence", () => {
    const out = renderRationale(
      baseInput({
        topClusters: [],
        uncoveredMoveHints: ["move-z-handler"],
      })
    );
    expect(out).not.toMatch(/Top tag clusters/);
    expect(out).toContain("move-z-handler");
  });

  it("decouples cluster line from consider-authoring line: clusters without hints emits no consider-authoring sentence", () => {
    const out = renderRationale(
      baseInput({
        topClusters: [{ tag: "x", count: 3 }],
        uncoveredMoveHints: [],
      })
    );
    expect(out).toContain("Top tag clusters");
    expect(out).not.toMatch(/not yet covered/);
  });

  it("separates sections by blank lines (paragraph breaks)", () => {
    const out = renderRationale(
      baseInput({
        topClusters: [{ tag: "x", count: 3 }],
        uncoveredMoveHints: ["move-x-handler"],
        topEvidenceClaimIds: ["claim-1"],
      })
    );
    // Four non-empty sections joined by double-newline.
    expect(out.split("\n\n")).toHaveLength(4);
  });
});
