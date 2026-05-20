// vault-mcp/tests/integration/evolve-profile-source-type-weights.test.ts
//
// T5 of the specialist-agent-substrate DAG (spec
// `wikis/_meta/specs/2026-05-19-specialist-agent-substrate-design.md` §5.4).
//
// Covers:
//   1. Default weights — 30 claims tagged `bedrock` all `source_type: lived`
//      produce `cluster_weight = 30.0`; the same 30 claims marked
//      `source_type: curricular` produce `cluster_weight = 15.0` (30 × 0.5).
//   2. Override mechanism — writing a `yaml source_type_weights` fence in the
//      test vault's `wikis/_agents/CLAUDE.md` with `lived: 0.8` is honored
//      (30 × 0.8 = 24.0).
//   3. Eligibility gate isolation — even with 30 high-confidence curricular
//      claims (15.0 cluster_weight), the legacy task-count eligibility
//      pathway is unaffected. `r.eligible` stays driven by stats only.
//
// Hermetic: every test runs against an `mkTempVault` under `os.tmpdir()`.

import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { rmSync } from "node:fs";
import path from "node:path";
import { mkTempVault } from "../helpers.js";
import { buildClaimsIndex, writeClaimsIndex } from "../../src/core/claims-index.js";
import { evolveProfileTool } from "../../src/tools/evolve-profile.js";

/**
 * Inline claim writer that supports the T1 `source_type` field. The shared
 * `writeClaimFile` helper in `tests/helpers.ts` is intentionally NOT
 * extended in this task (the helpers file is outside T5's `files:` scope);
 * inlining keeps the scope-discipline check passing.
 */
async function writeClaimWithSourceType(
  vaultPath: string,
  claim: {
    id: string;
    key: string;
    profile: string[];
    tags: string[];
    confidence: number;
    last_validated: string;
    source_type: "lived" | "curricular" | "retro";
    evidence?: string[];
  },
): Promise<void> {
  const wiki = "_agents";
  const dir = path.join(vaultPath, "wikis", wiki, "claim");
  await fs.mkdir(dir, { recursive: true });
  const fm: Record<string, unknown> = {
    id: claim.id,
    type: "claim",
    title: claim.id,
    created: "2026-05-02",
    key: claim.key,
    status: "active",
    confidence: claim.confidence,
    last_validated: claim.last_validated,
    profile: claim.profile,
    move: [],
    scope_wiki: [],
    tags: claim.tags,
    evidence: claim.evidence ?? [],
    authored_by: "agent:test",
    superseded_by: null,
    wiki,
    source_type: claim.source_type,
  };
  const yaml = Object.entries(fm)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");
  await fs.writeFile(
    path.join(dir, `${claim.id}.md`),
    `---\n${yaml}\n---\n\n`,
    "utf8",
  );
}

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
 * Seed `count` active claims tagged `tag`, attributed to `profileId`, with
 * the given `source_type`. `confidence: 1.0` keeps the per-claim
 * `effective_confidence × source_type_weight` math arithmetically clean
 * (claim_count × weight = expected cluster_weight). `last_validated` is
 * pinned strictly after `today` so decay clamps to zero.
 */
async function seedClaimCluster(
  vault: string,
  profileId: string,
  tag: string,
  count: number,
  sourceType: "lived" | "curricular" | "retro",
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await writeClaimWithSourceType(vault, {
      id: `claim-${tag}-${sourceType}-${i}`,
      key: `${tag}.case-${sourceType}-${i}`,
      confidence: 1.0,
      profile: [profileId],
      tags: [tag],
      evidence: [`[[journal-${tag}-${i}]]`],
      last_validated: "2026-05-01",
      source_type: sourceType,
    });
  }
}

/**
 * Write a `yaml source_type_weights` fenced block to the test vault's
 * `wikis/_agents/CLAUDE.md`. The block is the configuration surface
 * documented in spec §5.4; see `src/config.ts:readSourceTypeWeights`.
 */
async function writeWeightsOverride(
  vault: string,
  weights: { lived?: number; curricular?: number; retro?: number },
): Promise<void> {
  const agentsDir = path.join(vault, "wikis", "_agents");
  await fs.mkdir(agentsDir, { recursive: true });
  const claudeMd = path.join(agentsDir, "CLAUDE.md");
  const lines = ["# _agents", "", "```yaml source_type_weights"];
  if (weights.lived !== undefined) lines.push(`lived: ${weights.lived}`);
  if (weights.curricular !== undefined) lines.push(`curricular: ${weights.curricular}`);
  if (weights.retro !== undefined) lines.push(`retro: ${weights.retro}`);
  lines.push("```", "");
  await fs.writeFile(claudeMd, lines.join("\n"), "utf8");
}

describe("vault.evolve-profile source-type weights (T5, spec §5.4)", () => {
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

  it("default lived weight = 1.0: 30 lived claims tagged bedrock → cluster_weight 30.0", async () => {
    const vault = await mkTempVault();
    created.push(vault);
    await seedProfile(vault, "profile-x");
    await seedClaimCluster(vault, "profile-x", "bedrock", 30, "lived");
    await writeClaimsIndex(vault, await buildClaimsIndex(vault));

    const r = await evolveProfileTool.handler(
      { pokemon_id: "profile-x", commit: false, cleanup_old_skills_dir: true, wiki: "_agents" },
      { vaultPath: vault, today: new Date("2026-04-30"), rawConfig: {} },
    );

    const bedrock = r.proposed.specialties.find(
      (s: { tag: string }) => s.tag === "bedrock",
    );
    expect(bedrock).toBeTruthy();
    expect(bedrock!.claim_count).toBe(30);
    expect(bedrock!.cluster_weight).toBeCloseTo(30.0, 6);
  });

  it("default curricular weight = 0.5: 30 curricular claims tagged bedrock → cluster_weight 15.0", async () => {
    const vault = await mkTempVault();
    created.push(vault);
    await seedProfile(vault, "profile-x");
    await seedClaimCluster(vault, "profile-x", "bedrock", 30, "curricular");
    await writeClaimsIndex(vault, await buildClaimsIndex(vault));

    const r = await evolveProfileTool.handler(
      { pokemon_id: "profile-x", commit: false, cleanup_old_skills_dir: true, wiki: "_agents" },
      { vaultPath: vault, today: new Date("2026-04-30"), rawConfig: {} },
    );

    const bedrock = r.proposed.specialties.find(
      (s: { tag: string }) => s.tag === "bedrock",
    );
    expect(bedrock).toBeTruthy();
    expect(bedrock!.claim_count).toBe(30);
    expect(bedrock!.cluster_weight).toBeCloseTo(15.0, 6);
  });

  it("default retro weight = 0.7: 30 retro claims tagged bedrock → cluster_weight 21.0", async () => {
    const vault = await mkTempVault();
    created.push(vault);
    await seedProfile(vault, "profile-x");
    await seedClaimCluster(vault, "profile-x", "bedrock", 30, "retro");
    await writeClaimsIndex(vault, await buildClaimsIndex(vault));

    const r = await evolveProfileTool.handler(
      { pokemon_id: "profile-x", commit: false, cleanup_old_skills_dir: true, wiki: "_agents" },
      { vaultPath: vault, today: new Date("2026-04-30"), rawConfig: {} },
    );

    const bedrock = r.proposed.specialties.find(
      (s: { tag: string }) => s.tag === "bedrock",
    );
    expect(bedrock).toBeTruthy();
    expect(bedrock!.cluster_weight).toBeCloseTo(21.0, 6);
  });

  it("override via _agents/CLAUDE.md: lived=0.8 → 30 lived claims → cluster_weight 24.0", async () => {
    const vault = await mkTempVault();
    created.push(vault);
    await seedProfile(vault, "profile-x");
    await writeWeightsOverride(vault, { lived: 0.8 });
    await seedClaimCluster(vault, "profile-x", "bedrock", 30, "lived");
    await writeClaimsIndex(vault, await buildClaimsIndex(vault));

    const r = await evolveProfileTool.handler(
      { pokemon_id: "profile-x", commit: false, cleanup_old_skills_dir: true, wiki: "_agents" },
      { vaultPath: vault, today: new Date("2026-04-30"), rawConfig: {} },
    );

    const bedrock = r.proposed.specialties.find(
      (s: { tag: string }) => s.tag === "bedrock",
    );
    expect(bedrock).toBeTruthy();
    expect(bedrock!.claim_count).toBe(30);
    expect(bedrock!.cluster_weight).toBeCloseTo(24.0, 6);
  });

  it("eligibility gate (legacy task-count) is unaffected by source-type weights", async () => {
    // 30 lived claims well above any cluster threshold, but tasks_completed=0
    // in the seeded _index/profiles.json. The legacy `r.eligible` should
    // remain false because the v1.5 task-count gate has nothing to do with
    // claim weights.
    const vault = await mkTempVault();
    created.push(vault);
    await seedProfile(vault, "profile-x");
    await seedClaimCluster(vault, "profile-x", "bedrock", 30, "lived");
    await writeClaimsIndex(vault, await buildClaimsIndex(vault));

    const r = await evolveProfileTool.handler(
      { pokemon_id: "profile-x", commit: false, cleanup_old_skills_dir: true, wiki: "_agents" },
      { vaultPath: vault, today: new Date("2026-04-30"), rawConfig: {} },
    );

    // Legacy stats-driven gate: tasks_completed=0 < 30 default threshold.
    expect(r.eligible).toBe(false);
  });
});
