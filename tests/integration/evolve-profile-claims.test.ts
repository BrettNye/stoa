// vault-mcp/tests/integration/evolve-profile-claims.test.ts
//
// task-evolve-profile-integration-test (Claims Plan 2 Wave 4) — end-to-end
// proposal-phase coverage of the §9.2 acceptance behaviors layered on
// `vault.evolve-profile` by the Plan 2 commit 41c8acf (handler now ALWAYS
// threads `vaultPath` + `today` + `claimsConfig` into the orchestrator, so
// the claim-driven extensions are always populated when claims are present).
//
// Covers:
//   1. Cluster-size threshold — `specialty_min_cluster: 5` surfaces a
//      `specialties` entry exactly at the threshold and DROPS clusters at
//      threshold-1.
//   2. Eligibility advisory — under-threshold high-confidence claim count
//      yields `eligibility.eligible: false` with a `needs >=N` reason; the
//      call still succeeds (advisory only).
//   3. Moveset-suggestion dedup — a profile whose moveset already contains a
//      move whose SKILL.md frontmatter `tags:` covers the cluster tag does
//      NOT receive a `moveset_suggestion` for that tag.
//   4. Rationale templating — claim-driven rationale contains
//      `[[<claim-id>]]` wikilinks for the top-evidence claims AND the
//      literal phrase `Top tag clusters`.
//
// Drift notes (vs. the Plan 2 §task-evolve-profile-integration-test reference
// snippet, lines 1217-1271):
//   - The reference snippet calls through `callTool("vault.evolve-profile",
//     ...)`, but `callTool` in tests/helpers.ts passes a hard-coded
//     `rawConfig: {}` and bypasses Zod input parsing. Tests in this file
//     therefore call `evolveProfileTool.handler(...)` DIRECTLY, which (a)
//     gives us a place to inject `today` for deterministic decay, and (b)
//     lets us pass a custom `rawConfig` for the eligibility-advisory test
//     that needs a non-default `specialty_min_cluster`. The handler still
//     resolves defaults via `getClaimsConfig(ctx.rawConfig ?? {})`, so an
//     explicit `rawConfig: {}` matches the Zod-defaulted shape of a
//     production call.
//   - `ParsedClaim` spreads frontmatter fields on the root (`c.key`, not
//     `c.frontmatter.key`) — confirmed against `core/claims.ts:20`. Test
//     fixtures use `writeClaimFile` (tests/helpers.ts) which serializes the
//     same shape.
//   - The legacy v1.5 `r.eligible` field on the response is driven by
//     stats (tasks completed × success rate), which we leave at zero in
//     these fixtures (the task-claims index sidecar is the input we
//     control). The new `r.eligibility` block is the claim-driven
//     advisory we assert on.
//   - The rationale built by `core/evolution-claims.ts:renderRationale`
//     puts `[[<claim-id>]]` citations behind a "Top evidence:" line, which
//     fires only when at least one cluster survives. Acceptance criterion
//     5 mandates the citations appear, so all rationale tests seed at
//     least one surviving cluster.
//
// Hermetic: every test runs against an `mkTempVault` under `os.tmpdir()`;
// nothing reads or writes the live vault root.

import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { rmSync } from "node:fs";
import path from "node:path";
import { mkTempVault, writeClaimFile } from "../helpers.js";
import { buildClaimsIndex, writeClaimsIndex } from "../../src/core/claims-index.js";
import { evolveProfileTool } from "../../src/tools/evolve-profile.js";

/**
 * Seed a profile page with the given moveset AND the matching
 * `_index/profiles.json` row that `profileStatsTool` reads. The orchestrator
 * (`evolve-profile.ts:122`) always invokes `vault.profile-stats` first, which
 * throws `PROFILE_NOT_FOUND` unless `_index/profiles.json` exists with a row
 * for the given profile id (`profile-stats.ts:17-23`). We could spin up a
 * full `reindex` to populate the sidecar, but a hand-written minimal row
 * matches the integration-test contract (we control all inputs) and keeps
 * the test 10x faster — `reindex` walks the entire vault, much of which
 * doesn't exist in our hermetic fixtures.
 *
 * The profile page itself is written under `wikis/_agents/profiles/<id>.md`
 * (canonical location per the v1.5 substrate, `core/profiles.ts`). Only the
 * frontmatter fields the orchestrator actually reads are populated.
 */
async function seedProfile(
  vault: string,
  profileId: string,
  moveset: string[] = [],
  stage: "basic" | "stage1" | "stage2" = "basic",
): Promise<void> {
  const profileDir = path.join(vault, "wikis", "_agents", "profiles");
  await fs.mkdir(profileDir, { recursive: true });
  const movesetYaml = moveset.length > 0 ? `[${moveset.join(", ")}]` : "[]";
  const fm = `---
id: ${profileId}
type: profile
title: ${profileId}
created: 2026-01-01
wiki: _agents
status: active
pokemon_type: normal
evolution_stage: ${stage}
autonomy_level: restricted
moveset: ${movesetYaml}
applies_to: [claude-code]
---
`;
  await fs.writeFile(path.join(profileDir, `${profileId}.md`), fm, "utf8");

  // Populate _index/profiles.json so profileStatsTool (called by
  // evolve-profile.ts:122) doesn't throw PROFILE_NOT_FOUND. Stats are zero
  // because the claim-driven advisory (the actual subject of these tests)
  // doesn't depend on stats — the legacy v1.5 `r.eligible` does, and we
  // accept it being false for these fixtures.
  const indexDir = path.join(vault, "_index");
  await fs.mkdir(indexDir, { recursive: true });
  const profilesIndex: Record<string, unknown> = {
    [profileId]: {
      id: profileId,
      pokemon_type: "normal",
      evolution_stage: stage,
      moveset,
      tasks_completed: 0,
      tasks_failed: 0,
      tasks_in_flight: 0,
      journals_count: 0,
      channels_active: [],
      moves_used_freq: {},
      days_since_creation: 0,
    },
  };
  await fs.writeFile(
    path.join(indexDir, "profiles.json"),
    JSON.stringify(profilesIndex, null, 2),
    "utf8",
  );
}

/**
 * Seed a SKILL.md for a move in `wikis/_agents/moves/<id>/SKILL.md` with the
 * given `tags:` list. The orchestrator's moveset-coverage check
 * (`evolution-claims.ts:suggestMoves`) reads `tags ∪ applies_to`; we pass
 * `applies_to: []` so coverage is determined ONLY by the explicit `tags`
 * list — that's the behavior under test for criterion 4 (moveset dedup).
 */
async function seedMoveSkill(
  vault: string,
  moveId: string,
  tags: string[],
): Promise<void> {
  const moveDir = path.join(vault, "wikis", "_agents", "moves", moveId);
  await fs.mkdir(moveDir, { recursive: true });
  const tagYaml = `[${tags.map((t) => `"${t}"`).join(", ")}]`;
  await fs.writeFile(
    path.join(moveDir, "SKILL.md"),
    `---\nid: ${moveId}\ntags: ${tagYaml}\napplies_to: []\n---\n# ${moveId}\n`,
    "utf8",
  );
}

/**
 * Write `count` active claims tagged `tag`, attributed to `profileId`. Each
 * claim has its own (key, evidence) tuple so the sidecar's `by_profile`
 * bucket and the on-disk frontmatter agree on identity. `last_validated` is
 * pinned to a date strictly after `today` in the test (so decay clamps to
 * 0 days via `decay.ts:calendarDays(... Math.max(0,...))`) → effective
 * confidence equals stored confidence on the test date.
 */
async function seedClaimCluster(
  vault: string,
  profileId: string,
  tag: string,
  count: number,
  opts: { confidence?: number; idPrefix?: string } = {},
): Promise<void> {
  const conf = opts.confidence ?? 0.8;
  const prefix = opts.idPrefix ?? `claim-${tag}`;
  for (let i = 0; i < count; i++) {
    await writeClaimFile(vault, {
      id: `${prefix}-${i}`,
      key: `${tag}.case-${i}`,
      status: "active",
      confidence: conf,
      profile: [profileId],
      tags: [tag],
      evidence: [`[[journal-${tag}-${i}]]`],
      last_validated: "2026-05-01",
    });
  }
}

describe("vault.evolve-profile claims integration (Plan 2 §9.2)", () => {
  // Track temp vaults for cleanup so a failing test doesn't leak temp dirs.
  const created: string[] = [];
  afterEach(() => {
    while (created.length > 0) {
      const v = created.pop()!;
      try {
        rmSync(v, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
  });

  it("surfaces specialty when active-claim cluster size >= specialty_min_cluster (default 5)", async () => {
    // Acceptance criterion: A profile with 5 active claims tagged `windows`
    // (and `specialty_min_cluster: 5`) returns a `specialties` entry
    // `{ tag: "windows", claim_count: 5 }`.
    const vault = await mkTempVault();
    created.push(vault);
    await seedProfile(vault, "profile-x");
    await seedClaimCluster(vault, "profile-x", "windows", 5);
    await writeClaimsIndex(vault, await buildClaimsIndex(vault));

    const r = await evolveProfileTool.handler(
      { pokemon_id: "profile-x", commit: false, cleanup_old_skills_dir: true },
      { vaultPath: vault, today: new Date("2026-04-30"), rawConfig: {} },
    );

    const windows = r.proposed.specialties.find(
      (s: { tag: string; claim_count: number }) => s.tag === "windows",
    );
    expect(windows).toBeTruthy();
    expect(windows!.claim_count).toBe(5);
  });

  it("drops cluster from specialties when size is exactly threshold-1 (4 < 5)", async () => {
    // Acceptance criterion: The same profile with only 4 claims returns NO
    // specialty for `windows` (below threshold).
    const vault = await mkTempVault();
    created.push(vault);
    await seedProfile(vault, "profile-x");
    await seedClaimCluster(vault, "profile-x", "windows", 4);
    await writeClaimsIndex(vault, await buildClaimsIndex(vault));

    const r = await evolveProfileTool.handler(
      { pokemon_id: "profile-x", commit: false, cleanup_old_skills_dir: true },
      { vaultPath: vault, today: new Date("2026-04-30"), rawConfig: {} },
    );

    const windows = r.proposed.specialties.find(
      (s: { tag: string; claim_count: number }) => s.tag === "windows",
    );
    expect(windows).toBeUndefined();
    expect(r.proposed.specialties).toEqual([]);
  });

  it("eligibility advisory: under-threshold high-confidence count yields eligible:false with `needs >=N` reason; call still succeeds", async () => {
    // Acceptance criterion: A profile with 6 high-confidence claims and
    // `evolution_thresholds.stage1: 10` returns `eligibility.eligible: false`,
    // `eligibility.reason` matches `/needs >=10/`, and the call still
    // succeeds (advisory only).
    //
    // We seed 6 claims with high confidence (0.9). The default
    // `evolution_thresholds.stage1` per spec §6.2 is 10. The claim-driven
    // eligibility advisory should fire `eligible:false` because 6 < 10. The
    // top-level legacy `r.eligible` is stats-driven and will also be false
    // (we provide no completed tasks fixture); but the assertion is on
    // `r.eligibility.*`, the new advisory block.
    //
    // Note: 6 claims all tagged `solo` → one cluster of size 6 (above the
    // default `specialty_min_cluster: 5` so it survives clustering and counts
    // toward `loadActiveProfileClaims` → `enrichWithClaims` →
    // `computeEligibility(6, "basic", { stage1: 10, stage2: 25 })`.
    const vault = await mkTempVault();
    created.push(vault);
    await seedProfile(vault, "profile-x");
    await seedClaimCluster(vault, "profile-x", "solo", 6, { confidence: 0.9 });
    await writeClaimsIndex(vault, await buildClaimsIndex(vault));

    const r = await evolveProfileTool.handler(
      { pokemon_id: "profile-x", commit: false, cleanup_old_skills_dir: true },
      { vaultPath: vault, today: new Date("2026-04-30"), rawConfig: {} },
    );

    expect(r.eligibility).toBeTruthy();
    expect(r.eligibility.eligible).toBe(false);
    expect(r.eligibility.high_confidence_claim_count).toBe(6);
    expect(r.eligibility.threshold).toBe(10);
    expect(r.eligibility.reason).toMatch(/needs >=10/);
    // Call succeeded (no throw); response shape is well-formed.
    expect(r.proposed).toBeTruthy();
    expect(r.evidence_summary).toBeTruthy();
  });

  it("moveset_suggestions dedup: omits a hint for a tag already covered by an existing move's SKILL.md tags", async () => {
    // Acceptance criterion: A profile whose moveset already contains a move
    // with `tags: [windows]` in its SKILL.md does NOT receive a
    // `moveset_suggestion` for `windows` (dedup correct).
    //
    // Seed `move-windows-handler` with `tags: ["windows"]` in its SKILL.md
    // and assign it to the profile's moveset. Then seed 5 windows-tagged
    // claims (above specialty_min_cluster). Specialty for `windows` should
    // still appear (specialty != suggestion), but `moveset_suggestions`
    // should be empty for the windows tag.
    const vault = await mkTempVault();
    created.push(vault);
    await seedMoveSkill(vault, "move-windows-handler", ["windows"]);
    await seedProfile(vault, "profile-x", ["move-windows-handler"]);
    await seedClaimCluster(vault, "profile-x", "windows", 5);
    await writeClaimsIndex(vault, await buildClaimsIndex(vault));

    const r = await evolveProfileTool.handler(
      { pokemon_id: "profile-x", commit: false, cleanup_old_skills_dir: true },
      { vaultPath: vault, today: new Date("2026-04-30"), rawConfig: {} },
    );

    // Specialty surfaces (not gated by moveset coverage).
    expect(
      r.proposed.specialties.find(
        (s: { tag: string }) => s.tag === "windows",
      ),
    ).toBeTruthy();
    // Suggestion suppressed by the SKILL.md tag-coverage check.
    expect(
      r.proposed.moveset_suggestions.find(
        (m: { tag_cluster: string[] }) => m.tag_cluster.includes("windows"),
      ),
    ).toBeUndefined();
    expect(r.proposed.moveset_suggestions).toEqual([]);
  });

  it("rationale templating: contains `[[<claim-id>]]` wikilinks for top evidence and the literal `Top tag clusters` phrase", async () => {
    // Acceptance criterion: The returned `rationale` contains `[[<claim-id>]]`
    // wikilinks for the top-evidence claims AND the literal phrase
    // `Top tag clusters`.
    //
    // Seed 5 windows claims (above the cluster threshold so a cluster
    // survives → `Top tag clusters: ...` line fires). Each claim's id is
    // distinct so the orchestrator's top-3 evidence selection produces
    // 3 distinct `[[claim-...]]` wikilinks via `renderRationale`.
    const vault = await mkTempVault();
    created.push(vault);
    await seedProfile(vault, "profile-x");
    await seedClaimCluster(vault, "profile-x", "windows", 5, {
      idPrefix: "claim-evidence",
    });
    await writeClaimsIndex(vault, await buildClaimsIndex(vault));

    const r = await evolveProfileTool.handler(
      { pokemon_id: "profile-x", commit: false, cleanup_old_skills_dir: true },
      { vaultPath: vault, today: new Date("2026-04-30"), rawConfig: {} },
    );

    expect(typeof r.rationale).toBe("string");
    // Literal `Top tag clusters` phrase per renderRationale (cluster line).
    expect(r.rationale).toContain("Top tag clusters");
    // Top evidence line cites at least one `[[claim-...]]` wikilink.
    expect(r.rationale).toContain("Top evidence:");
    expect(r.rationale).toMatch(/\[\[claim-evidence-\d+\]\]/);
    // Sanity: the rendered rationale references the test profile.
    expect(r.rationale).toContain("profile-x");
  });
});
