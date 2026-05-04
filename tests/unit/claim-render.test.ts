// vault-mcp/tests/unit/claim-render.test.ts
//
// task-claim-render-shared (Claims Plan 3, Wave 1 root) — four exports:
//   - loadActiveMoveClaims (sidecar-first by-move loader; mirrors Plan-2's
//     loadActiveProfileClaims)
//   - rankClaimsForDeployingProfile (deploying-profile-boost ranker; pure)
//   - formatClaimBullet (per-claim bullet formatter; spec §8.2 step 4)
//   - renderClaimSectionInSkillMd (per-move SKILL.md orchestrator; §8.2 step 5)
//
// Hermetic: every fixture under os.tmpdir() via mkTempVault helpers. `today`
// injected through every call path; module never reads `Date.now()`.

import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  loadActiveMoveClaims,
  rankClaimsForDeployingProfile,
  formatClaimBullet,
  renderClaimSectionInSkillMd,
} from "../../src/core/claim-render.js";
import type { ParsedClaim } from "../../src/core/claims.js";
import type { ClaimsConfig } from "../../src/config.js";
import { ClaimsConfigSchema } from "../../src/config.js";
import {
  mkTempVault,
  mkTempVaultWithSidecar,
  writeClaimFile,
} from "../helpers.js";

const TODAY = new Date("2026-05-03T00:00:00Z");
const defaultConfig: ClaimsConfig = ClaimsConfigSchema.parse({});

function fakeParsed(
  id: string,
  overrides: Partial<ParsedClaim> = {},
): ParsedClaim {
  return {
    id,
    type: "claim",
    title: id,
    created: "2026-05-02",
    key: `k.${id}`,
    confidence: 0.9,
    last_validated: "2026-05-02",
    profile: [],
    move: [],
    scope_wiki: [],
    tags: [],
    evidence: [],
    status: "active",
    supersedes: [],
    superseded_by: null,
    retracted_at: null,
    retracted_by: null,
    retraction_reason: null,
    body: "",
    filePath: `<test:${id}>`,
    mtime: "2026-05-02T00:00:00.000Z",
    ...overrides,
  } as ParsedClaim;
}

async function mkTempSkillFile(content: string): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), "skill-md-test-"));
  const file = path.join(dir, "SKILL.md");
  await fs.writeFile(file, content, "utf8");
  return file;
}

// ───────────────────────────────────────────────────────────────────────────
// loadActiveMoveClaims
// ───────────────────────────────────────────────────────────────────────────

describe("loadActiveMoveClaims", () => {
  it("uses the sidecar's by_move index when present", async () => {
    const vault = await mkTempVaultWithSidecar([
      {
        id: "claim-tdd-1",
        key: "k.a",
        status: "active",
        confidence: 0.9,
        last_validated: "2026-05-02",
        move: ["move-tdd-cycle"],
      },
      {
        id: "claim-other-1",
        key: "k.b",
        status: "active",
        confidence: 0.9,
        last_validated: "2026-05-02",
        move: ["move-other"],
      },
    ]);

    const out = await loadActiveMoveClaims(
      vault,
      "move-tdd-cycle",
      TODAY,
      defaultConfig,
    );
    expect(out.length).toBe(1);
    expect(out[0].id).toBe("claim-tdd-1");
  });

  it("falls back to disk walk when the sidecar is absent", async () => {
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-disk-1",
      key: "k.a",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      move: ["move-tdd-cycle"],
    });
    await writeClaimFile(vault, {
      id: "claim-disk-2",
      key: "k.b",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      move: ["move-other"],
    });
    // No _index/claims.json present.

    const out = await loadActiveMoveClaims(
      vault,
      "move-tdd-cycle",
      TODAY,
      defaultConfig,
    );
    expect(out.length).toBe(1);
    expect(out[0].id).toBe("claim-disk-1");
  });

  it("returns empty when sidecar absent AND no claim files exist", async () => {
    const vault = await mkTempVault();
    const out = await loadActiveMoveClaims(
      vault,
      "move-tdd-cycle",
      TODAY,
      defaultConfig,
    );
    expect(out).toEqual([]);
  });

  it("filters out non-active claims even if listed in the sidecar", async () => {
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-active",
      key: "k.a",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      move: ["move-tdd-cycle"],
    });
    await writeClaimFile(vault, {
      id: "claim-superseded",
      key: "k.b",
      status: "superseded",
      confidence: 0.9,
      last_validated: "2026-05-02",
      move: ["move-tdd-cycle"],
      superseded_by: "claim-active",
    });
    await fs.writeFile(
      path.join(vault, "_index", "claims.json"),
      JSON.stringify({
        by_move: { "move-tdd-cycle": ["claim-active", "claim-superseded"] },
      }),
      "utf8",
    );

    const out = await loadActiveMoveClaims(
      vault,
      "move-tdd-cycle",
      TODAY,
      defaultConfig,
    );
    expect(out.map((c) => c.id)).toEqual(["claim-active"]);
  });

  it("excludes claims whose move array does not include the requested moveId", async () => {
    // Sidecar lies; loader trusts on-disk frontmatter.
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-mislabeled",
      key: "k.a",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      move: ["move-other"],
    });
    await fs.writeFile(
      path.join(vault, "_index", "claims.json"),
      JSON.stringify({
        by_move: { "move-tdd-cycle": ["claim-mislabeled"] },
      }),
      "utf8",
    );

    const out = await loadActiveMoveClaims(
      vault,
      "move-tdd-cycle",
      TODAY,
      defaultConfig,
    );
    expect(out.length).toBe(0);
  });

  it("excludes claims whose effective confidence is below render_min_confidence", async () => {
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-strong",
      key: "k.a",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      move: ["move-tdd-cycle"],
    });
    await writeClaimFile(vault, {
      id: "claim-weak",
      key: "k.b",
      status: "active",
      confidence: 0.2, // below default render_min_confidence (0.4)
      last_validated: "2026-05-02",
      move: ["move-tdd-cycle"],
    });

    const out = await loadActiveMoveClaims(
      vault,
      "move-tdd-cycle",
      TODAY,
      defaultConfig,
    );
    expect(out.map((c) => c.id)).toEqual(["claim-strong"]);
  });

  it("returns empty for an unknown moveId when the sidecar is present", async () => {
    const vault = await mkTempVaultWithSidecar([
      {
        id: "claim-1",
        key: "k.a",
        status: "active",
        confidence: 0.9,
        last_validated: "2026-05-02",
        move: ["move-tdd-cycle"],
      },
    ]);
    const out = await loadActiveMoveClaims(
      vault,
      "move-ghost",
      TODAY,
      defaultConfig,
    );
    expect(out).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// rankClaimsForDeployingProfile
// ───────────────────────────────────────────────────────────────────────────

describe("rankClaimsForDeployingProfile", () => {
  it("returns a new array (does not mutate input)", () => {
    const input = [
      fakeParsed("a", { confidence: 0.5 }),
      fakeParsed("b", { confidence: 0.9 }),
    ];
    const before = input.map((c) => c.id);
    const out = rankClaimsForDeployingProfile(
      input,
      "profile-pikachu",
      TODAY,
      defaultConfig,
    );
    expect(input.map((c) => c.id)).toEqual(before);
    expect(out).not.toBe(input);
  });

  it("sorts by effective confidence descending in the absence of a boost", () => {
    const a = fakeParsed("a", { confidence: 0.5 });
    const b = fakeParsed("b", { confidence: 0.9 });
    const out = rankClaimsForDeployingProfile(
      [a, b],
      "profile-pikachu",
      TODAY,
      defaultConfig,
    );
    expect(out.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("applies the +0.1 boost when the deploying profile is in claim.profile", () => {
    // a: confidence 0.85, no profile match → eff 0.85
    // b: confidence 0.80, deploying profile match → 0.80 + 0.1 = 0.90
    // Boosted b should rank above a.
    const a = fakeParsed("a", { confidence: 0.85 });
    const b = fakeParsed("b", {
      confidence: 0.8,
      profile: ["profile-pikachu"],
    });
    const out = rankClaimsForDeployingProfile(
      [a, b],
      "profile-pikachu",
      TODAY,
      defaultConfig,
    );
    expect(out.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("applies no boost when the deploying profile is not in claim.profile", () => {
    const a = fakeParsed("a", { confidence: 0.85 });
    const b = fakeParsed("b", {
      confidence: 0.8,
      profile: ["profile-bulbasaur"],
    });
    const out = rankClaimsForDeployingProfile(
      [a, b],
      "profile-pikachu",
      TODAY,
      defaultConfig,
    );
    // No match → b stays below a (0.85 > 0.80)
    expect(out.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("does not mutate claim.confidence — the boost is ranking-only", () => {
    const b = fakeParsed("b", {
      confidence: 0.8,
      profile: ["profile-pikachu"],
    });
    const before = b.confidence;
    rankClaimsForDeployingProfile([b], "profile-pikachu", TODAY, defaultConfig);
    expect(b.confidence).toBe(before);
  });

  it("returns an empty array on empty input", () => {
    const out = rankClaimsForDeployingProfile(
      [],
      "profile-pikachu",
      TODAY,
      defaultConfig,
    );
    expect(out).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// formatClaimBullet
// ───────────────────────────────────────────────────────────────────────────

describe("formatClaimBullet", () => {
  // Spec §8.2 step 4 / §8.3 same-format. Effective confidence rounded to 2 dp.
  // Only the first evidence entry is rendered; missing evidence omits the clause.
  const SHAPE_RE =
    /^- \*\*`[a-z0-9-]+(\.[a-z0-9-]+){1,3}`\*\* — .+\. \*\(confidence \d\.\d{2} as of \d{4}-\d{2}-\d{2}, validated \d{4}-\d{2}-\d{2}(, evidence: \[\[.+\]\])?\)\*$/;

  it("renders all four pieces in the canonical format", () => {
    const claim = fakeParsed("c", {
      key: "k.foo",
      summary: "the body",
      confidence: 0.9,
      last_validated: "2026-05-02",
      evidence: ["evidence-1", "evidence-2"],
    });
    const out = formatClaimBullet(claim, TODAY, defaultConfig);
    expect(out).toMatch(SHAPE_RE);
    expect(out).toContain("**`k.foo`**");
    expect(out).toContain("the body");
    expect(out).toContain("validated 2026-05-02");
    expect(out).toContain("as of 2026-05-03");
  });

  it("rounds effective confidence to exactly 2 decimal places", () => {
    // 75-day half-life default; 1-day decay shrinks confidence trivially
    // but the toFixed(2) result must still have exactly 2 fraction digits.
    const claim = fakeParsed("c", {
      key: "k.bar",
      summary: "x",
      confidence: 0.9,
      last_validated: "2026-05-02",
    });
    const out = formatClaimBullet(claim, TODAY, defaultConfig);
    const m = out.match(/confidence (\d\.\d{2}) as of/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/^\d\.\d{2}$/);
  });

  it("renders only the first evidence entry", () => {
    const claim = fakeParsed("c", {
      key: "k.baz",
      summary: "x",
      confidence: 0.9,
      last_validated: "2026-05-02",
      evidence: ["first-link", "second-link", "third-link"],
    });
    const out = formatClaimBullet(claim, TODAY, defaultConfig);
    expect(out).toContain("[[first-link]]");
    expect(out).not.toContain("second-link");
    expect(out).not.toContain("third-link");
  });

  it("omits the evidence clause when claim.evidence is empty", () => {
    const claim = fakeParsed("c", {
      key: "k.qux",
      summary: "x",
      confidence: 0.9,
      last_validated: "2026-05-02",
      evidence: [],
    });
    const out = formatClaimBullet(claim, TODAY, defaultConfig);
    expect(out).not.toContain("evidence:");
    expect(out).toMatch(SHAPE_RE);
  });

  it("uses claim.body when summary is absent", () => {
    const claim = fakeParsed("c", {
      key: "k.body",
      summary: undefined,
      body: "body text",
      confidence: 0.9,
      last_validated: "2026-05-02",
    });
    const out = formatClaimBullet(claim, TODAY, defaultConfig);
    expect(out).toContain("body text");
  });

  it("uses today.toISOString() for the render date", () => {
    const claim = fakeParsed("c", {
      key: "k.date",
      summary: "x",
      confidence: 0.9,
      last_validated: "2026-04-30",
    });
    const customToday = new Date("2027-01-15T00:00:00Z");
    // Custom config to avoid floor masking real decay over many days.
    const cfg = ClaimsConfigSchema.parse({
      half_life_days: 365,
      render_min_confidence: 0,
    });
    const out = formatClaimBullet(claim, customToday, cfg);
    expect(out).toContain("as of 2027-01-15");
  });

  it("collapses embedded newlines in claim.body to a single line", () => {
    // Regression: gray-matter leaves the post-frontmatter remainder in body,
    // typically starting with `\n` and possibly containing internal newlines
    // when the author wrote multi-paragraph body text. A bare `.trim()` only
    // strips boundary whitespace; embedded `\n` would break the bullet line
    // and corrupt the vault-claims:start..end block.
    const claim = fakeParsed("c", {
      key: "k.multi",
      summary: undefined,
      body: "\nfirst paragraph.\n\nsecond paragraph.\n",
      confidence: 0.9,
      last_validated: "2026-05-02",
    });
    const out = formatClaimBullet(claim, TODAY, defaultConfig);
    expect(out).not.toContain("\n");
    // Both sentences should still be present (collapsed, not truncated).
    expect(out).toContain("first paragraph.");
    expect(out).toContain("second paragraph.");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// renderClaimSectionInSkillMd
// ───────────────────────────────────────────────────────────────────────────

describe("renderClaimSectionInSkillMd", () => {
  it("renders top-N bullets between vault-claims markers", async () => {
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-1",
      key: "k.alpha",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      move: ["move-tdd-cycle"],
      evidence: ["ev-1"],
    });
    await writeClaimFile(vault, {
      id: "claim-2",
      key: "k.beta",
      status: "active",
      confidence: 0.85,
      last_validated: "2026-05-02",
      move: ["move-tdd-cycle"],
    });

    const skill = await mkTempSkillFile(
      "---\nid: move-tdd-cycle\ntype: move\n---\n\n# TDD\n\nbody\n",
    );

    await renderClaimSectionInSkillMd({
      skillMdPath: skill,
      moveId: "move-tdd-cycle",
      deployingProfileId: "profile-pikachu",
      vaultPath: vault,
      today: TODAY,
      config: defaultConfig,
    });

    const out = await fs.readFile(skill, "utf8");
    expect(out).toContain("<!-- vault-claims:start");
    expect(out).toContain("<!-- vault-claims:end -->");
    expect(out).toContain("## Learned");
    expect(out).toContain("**`k.alpha`**");
    expect(out).toContain("**`k.beta`**");
    expect(out).toContain("[[ev-1]]");
  });

  it("removes any prior render when claim_render: false is set", async () => {
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-1",
      key: "k.a",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      move: ["move-tdd-cycle"],
    });

    const initial = [
      "---",
      "id: move-tdd-cycle",
      "type: move",
      "claim_render: false",
      "---",
      "",
      "# TDD",
      "",
      "<!-- vault-claims:start (rendered: 2026-05-01) -->",
      "## Learned",
      "",
      "- old bullet",
      "<!-- vault-claims:end -->",
      "",
      "## Notes",
      "",
    ].join("\n");

    const skill = await mkTempSkillFile(initial);
    await renderClaimSectionInSkillMd({
      skillMdPath: skill,
      moveId: "move-tdd-cycle",
      deployingProfileId: "profile-pikachu",
      vaultPath: vault,
      today: TODAY,
      config: defaultConfig,
    });

    const out = await fs.readFile(skill, "utf8");
    expect(out).not.toContain("vault-claims:start");
    expect(out).not.toContain("vault-claims:end");
    expect(out).not.toContain("- old bullet");
    expect(out).toContain("## Notes");
  });

  it("honors claim_render_limit from frontmatter when present", async () => {
    const vault = await mkTempVault();
    for (let i = 0; i < 5; i++) {
      await writeClaimFile(vault, {
        id: `claim-${i}`,
        key: `k.${i}`,
        status: "active",
        confidence: 0.9 - i * 0.05, // descending so order is deterministic
        last_validated: "2026-05-02",
        move: ["move-tdd-cycle"],
      });
    }

    const skill = await mkTempSkillFile(
      "---\nid: move-tdd-cycle\ntype: move\nclaim_render_limit: 2\n---\n\n# TDD\n",
    );

    await renderClaimSectionInSkillMd({
      skillMdPath: skill,
      moveId: "move-tdd-cycle",
      deployingProfileId: "profile-pikachu",
      vaultPath: vault,
      today: TODAY,
      config: defaultConfig,
    });

    const out = await fs.readFile(skill, "utf8");
    // Only top 2 should appear.
    expect(out).toContain("**`k.0`**");
    expect(out).toContain("**`k.1`**");
    expect(out).not.toContain("**`k.2`**");
    expect(out).not.toContain("**`k.3`**");
    expect(out).not.toContain("**`k.4`**");
  });

  it("falls back to config.render_default_limit when frontmatter omits the override", async () => {
    const vault = await mkTempVault();
    for (let i = 0; i < 5; i++) {
      await writeClaimFile(vault, {
        id: `claim-${i}`,
        key: `k.${i}`,
        status: "active",
        confidence: 0.9 - i * 0.05,
        last_validated: "2026-05-02",
        move: ["move-tdd-cycle"],
      });
    }

    const cfg = ClaimsConfigSchema.parse({ render_default_limit: 3 });
    const skill = await mkTempSkillFile(
      "---\nid: move-tdd-cycle\ntype: move\n---\n\n# TDD\n",
    );

    await renderClaimSectionInSkillMd({
      skillMdPath: skill,
      moveId: "move-tdd-cycle",
      deployingProfileId: "profile-pikachu",
      vaultPath: vault,
      today: TODAY,
      config: cfg,
    });

    const out = await fs.readFile(skill, "utf8");
    expect(out).toContain("**`k.0`**");
    expect(out).toContain("**`k.1`**");
    expect(out).toContain("**`k.2`**");
    expect(out).not.toContain("**`k.3`**");
    expect(out).not.toContain("**`k.4`**");
  });

  it("removes any prior render when zero qualifying claims remain", async () => {
    const vault = await mkTempVault();
    // Below render_min_confidence — won't qualify.
    await writeClaimFile(vault, {
      id: "claim-weak",
      key: "k.a",
      status: "active",
      confidence: 0.1,
      last_validated: "2026-05-02",
      move: ["move-tdd-cycle"],
    });

    const initial = [
      "---",
      "id: move-tdd-cycle",
      "type: move",
      "---",
      "",
      "# TDD",
      "",
      "<!-- vault-claims:start (rendered: 2026-05-01) -->",
      "## Learned",
      "",
      "- old bullet",
      "<!-- vault-claims:end -->",
      "",
      "## Notes",
      "",
    ].join("\n");

    const skill = await mkTempSkillFile(initial);
    await renderClaimSectionInSkillMd({
      skillMdPath: skill,
      moveId: "move-tdd-cycle",
      deployingProfileId: "profile-pikachu",
      vaultPath: vault,
      today: TODAY,
      config: defaultConfig,
    });

    const out = await fs.readFile(skill, "utf8");
    expect(out).not.toContain("vault-claims:start");
    expect(out).not.toContain("- old bullet");
    expect(out).toContain("## Notes");
  });

  it("is idempotent: re-rendering with the same corpus and same today yields a byte-identical file", async () => {
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-1",
      key: "k.a",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      move: ["move-tdd-cycle"],
      evidence: ["ev-1"],
    });
    await writeClaimFile(vault, {
      id: "claim-2",
      key: "k.b",
      status: "active",
      confidence: 0.85,
      last_validated: "2026-05-02",
      move: ["move-tdd-cycle"],
    });

    const skill = await mkTempSkillFile(
      "---\nid: move-tdd-cycle\ntype: move\n---\n\n# TDD\n",
    );

    const args = {
      skillMdPath: skill,
      moveId: "move-tdd-cycle",
      deployingProfileId: "profile-pikachu",
      vaultPath: vault,
      today: TODAY,
      config: defaultConfig,
    };
    await renderClaimSectionInSkillMd(args);
    const first = await fs.readFile(skill, "utf8");
    await renderClaimSectionInSkillMd(args);
    const second = await fs.readFile(skill, "utf8");
    expect(second).toBe(first);
    // Third pass for paranoia.
    await renderClaimSectionInSkillMd(args);
    const third = await fs.readFile(skill, "utf8");
    expect(third).toBe(first);
  });

  it("applies the deploying-profile boost when picking the top-N", async () => {
    const vault = await mkTempVault();
    // a: confidence 0.85, no profile → eff 0.85
    // b: confidence 0.80, has deploying profile → eff 0.80 + 0.1 = 0.90
    await writeClaimFile(vault, {
      id: "claim-a",
      key: "k.a",
      status: "active",
      confidence: 0.85,
      last_validated: "2026-05-02",
      move: ["move-tdd-cycle"],
    });
    await writeClaimFile(vault, {
      id: "claim-b",
      key: "k.b",
      status: "active",
      confidence: 0.8,
      last_validated: "2026-05-02",
      move: ["move-tdd-cycle"],
      profile: ["profile-pikachu"],
    });

    const skill = await mkTempSkillFile(
      "---\nid: move-tdd-cycle\ntype: move\nclaim_render_limit: 1\n---\n\n# TDD\n",
    );

    await renderClaimSectionInSkillMd({
      skillMdPath: skill,
      moveId: "move-tdd-cycle",
      deployingProfileId: "profile-pikachu",
      vaultPath: vault,
      today: TODAY,
      config: defaultConfig,
    });

    const out = await fs.readFile(skill, "utf8");
    // Only top-1 — must be the boosted claim-b (k.b), not k.a.
    expect(out).toContain("**`k.b`**");
    expect(out).not.toContain("**`k.a`**");
  });

  it("treats string-valued claim_render: \"false\" the same as boolean false", async () => {
    // Regression: gray-matter parses unquoted `false` as boolean but quoted
    // `"false"` as the string "false". Both look identical in a Markdown
    // editor; strict equality `=== false` silently ignored the string form,
    // causing the orchestrator to render even though the author opted out.
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-1",
      key: "k.a",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      move: ["move-tdd-cycle"],
    });

    const initial = [
      "---",
      "id: move-tdd-cycle",
      "type: move",
      'claim_render: "false"',
      "---",
      "",
      "# TDD",
      "",
      "<!-- vault-claims:start (rendered: 2026-05-01) -->",
      "## Learned",
      "",
      "- old bullet",
      "<!-- vault-claims:end -->",
      "",
      "## Notes",
      "",
    ].join("\n");

    const skill = await mkTempSkillFile(initial);
    await renderClaimSectionInSkillMd({
      skillMdPath: skill,
      moveId: "move-tdd-cycle",
      deployingProfileId: "profile-pikachu",
      vaultPath: vault,
      today: TODAY,
      config: defaultConfig,
    });

    const out = await fs.readFile(skill, "utf8");
    // Same expectations as the boolean-false test above.
    expect(out).not.toContain("vault-claims:start");
    expect(out).not.toContain("vault-claims:end");
    expect(out).not.toContain("- old bullet");
    expect(out).toContain("## Notes");
  });

  it("does not write the file when claim_render: false and no prior block exists", async () => {
    const vault = await mkTempVault();
    const initial =
      "---\nid: move-tdd-cycle\ntype: move\nclaim_render: false\n---\n\n# TDD\n";
    const skill = await mkTempSkillFile(initial);
    const beforeMtime = (await fs.stat(skill)).mtimeMs;

    // Yield a tick so any write would change mtime.
    await new Promise((r) => setTimeout(r, 10));

    await renderClaimSectionInSkillMd({
      skillMdPath: skill,
      moveId: "move-tdd-cycle",
      deployingProfileId: "profile-pikachu",
      vaultPath: vault,
      today: TODAY,
      config: defaultConfig,
    });

    const after = await fs.readFile(skill, "utf8");
    expect(after).toBe(initial);
    const afterMtime = (await fs.stat(skill)).mtimeMs;
    expect(afterMtime).toBe(beforeMtime);
  });
});
