// vault-mcp/tests/integration/sync-skills-claims.test.ts
//
// task-sync-skills-integration-test (Claims Plan 3, Wave 3) — end-to-end
// test for §8.2 SKILL.md claim rendering during `vault.sync-skills`. Sibling
// to tests/unit/sync-skills-claim-render.test.ts (Wave 2) — the unit test
// covers the pre-render loop in isolation; this integration test exercises
// the full handler-deploy-render cycle through a temp vault with a profile,
// moveset, per-move SKILL.md fixtures, a curated claim corpus, AND a written
// `_index/claims.json` sidecar so the sidecar-fast-path is exercised.
//
// Hermetic: every fixture under `os.tmpdir()` via `mkTempVault`; nothing
// touches the live vault root.
//
// Invocation pattern (per the task brief): we invoke `syncSkillsTool.handler`
// directly with an explicit ctx instead of going through `callTool`, because
// `callTool` bypasses Zod (no schema validation) AND hard-codes
// `rawConfig: {}` and never injects `today`. Direct handler invocation gives
// us the deterministic clock + raw-config control needed for idempotency
// assertions and threshold-aware tests. This mirrors the discipline in the
// Plan-2 sibling at synthesize-by-agent-claims.test.ts.
//
// Coverage map (acceptance criteria from the task brief):
//   1. After sync-skills with one active claim under by_move[move-x] matching
//      the deploying profile, vault SKILL.md contains the marker block + the
//      `## Learned` heading + the `**`test.k1`**` bullet + `evidence: [[...]]`.
//
// REFERENCE-SNIPPET DRIFT (resolution: prefer the binding acceptance text):
// the task brief's reference snippet seeded `evidence: ["[[journal-1]]"]` and
// asserted `evidence: [[journal-1]]`. Those two contradict because
// `formatClaimBullet` (claim-render.ts:181) wraps `firstEvidence` in `[[...]]`
// — passing `[[journal-1]]` produces `[[[[journal-1]]]]`. The Wave 2 unit
// test (sync-skills-claim-render.test.ts:114) seeds `evidence: ["ev-1"]` and
// asserts `[[ev-1]]`, which is the consistent shape. The binding acceptance
// criterion `evidence: [[journal-1]]` wins, so we seed the bare id
// `journal-1` and let formatClaimBullet add the brackets.
//   2. Re-running sync-skills with the same corpus + same injected `today`
//      produces a byte-identical SKILL.md.
//   3. SKILL.md with `claim_render: false` in frontmatter does NOT receive a
//      vault-claims block on first sync; if a prior sync left one and the
//      flag is THEN added, the next sync removes the block.
//   4. SKILL.md with `claim_render_limit: 2` in frontmatter caps rendered
//      bullets at 2 even when 5 qualifying claims exist for that move.
//   5. A move with zero qualifying claims AND a previously-rendered block
//      has the block removed on next sync.

import { describe, it, expect, vi, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { rmSync } from "node:fs";
import path from "node:path";
import { mkTempVault, writeClaimFile } from "../helpers.js";
import { syncSkillsTool } from "../../src/tools/sync-skills.js";
import {
  buildClaimsIndex,
  writeClaimsIndex,
} from "../../src/core/claims-index.js";

// One canonical instant for the deterministic clock. Chosen STRICTLY BEFORE
// the fixture's `last_validated` (2026-05-01) so `decay.ts:calendarDays`
// clamps decay to 0 days — displayed effective confidence equals the raw
// confidence on every run, regardless of how many days the test wall-clock
// advanced. This keeps idempotency assertions honest. Same seam used in the
// Plan-2 sibling synthesize-by-agent-claims.test.ts.
const TODAY_ISO = "2026-04-30T12:00:00Z";
const TODAY = new Date(TODAY_ISO);

/**
 * Seed a profile page declaring `moveset: [moveId]` plus a per-move SKILL.md
 * with optional extra frontmatter (used to inject `claim_render: false` and
 * `claim_render_limit: <N>` overrides). Frontmatter values are JSON.stringify-
 * encoded so YAML quoting is unambiguous (matches the writeClaimFile helper).
 */
async function seedProfileAndMove(
  vault: string,
  profileId: string,
  moveId: string,
  skillFrontmatter: Record<string, unknown> = {},
): Promise<void> {
  const profileDir = path.join(vault, "wikis", "_agents", "profiles");
  await fs.mkdir(profileDir, { recursive: true });
  await fs.writeFile(
    path.join(profileDir, `${profileId}.md`),
    `---\nid: ${profileId}\ntype: profile\nwiki: _agents\nmoveset: [${moveId}]\n---\n`,
  );
  const moveDir = path.join(vault, "wikis", "_agents", "moves", moveId);
  await fs.mkdir(moveDir, { recursive: true });
  const fmLines = ["---", `id: ${moveId}`, `type: move`];
  for (const [k, v] of Object.entries(skillFrontmatter)) {
    fmLines.push(`${k}: ${JSON.stringify(v)}`);
  }
  fmLines.push("---", "", `# ${moveId}`, "");
  await fs.writeFile(path.join(moveDir, "SKILL.md"), fmLines.join("\n"));
}

/**
 * Convenience: invoke the sync-skills handler with the deterministic clock
 * and a fresh empty raw-config (which getClaimsConfig resolves to all spec
 * §6.2 defaults). `repo_path` defaults to a sibling temp dir under `vault`
 * so callers don't need to plumb a separate cleanup handle.
 */
async function runSync(
  vault: string,
  profileId: string,
  repo?: string,
): Promise<void> {
  const repoPath = repo ?? path.join(vault, "tmp-repo");
  await fs.mkdir(repoPath, { recursive: true });
  await syncSkillsTool.handler(
    {
      repo_path: repoPath,
      pokemon: profileId,
      target: "claude-code",
      mode: "copy",
      reverify: false,
      fix: false,
    },
    { vaultPath: vault, today: TODAY, rawConfig: {} } as any,
  );
}

function skillPath(vault: string, moveId: string): string {
  return path.join(
    vault,
    "wikis",
    "_agents",
    "moves",
    moveId,
    "SKILL.md",
  );
}

describe("vault.sync-skills claims integration (§8.2)", () => {
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

  it("renders ## Learned section with the qualifying bullet into vault SKILL.md after sync", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(TODAY);
      const vault = await mkTempVault();
      created.push(vault);
      await seedProfileAndMove(vault, "profile-x", "move-x");
      await writeClaimFile(vault, {
        id: "claim-1",
        key: "test.k1",
        status: "active",
        confidence: 0.8,
        profile: ["profile-x"],
        move: ["move-x"],
        evidence: ["journal-1"],
        last_validated: "2026-05-01",
      });
      // Build and write the sidecar so loadActiveMoveClaims hits the
      // sidecar-fast-path (by_move["move-x"]) instead of falling back to
      // the disk walk. Both paths converge on the same per-claim filter,
      // but exercising the sidecar matches the production hot path.
      await writeClaimsIndex(vault, await buildClaimsIndex(vault));

      await runSync(vault, "profile-x");

      const skillMd = await fs.readFile(skillPath(vault, "move-x"), "utf8");
      expect(skillMd).toContain("<!-- vault-claims:start");
      expect(skillMd).toContain("<!-- vault-claims:end -->");
      expect(skillMd).toContain("## Learned");
      // Spec-required bullet shape: backtick-wrapped key inside bold.
      expect(skillMd).toContain("**`test.k1`**");
      // Evidence renders as a wikilink — the FIRST evidence entry only per
      // formatClaimBullet contract.
      expect(skillMd).toContain("evidence: [[journal-1]]");
    } finally {
      vi.useRealTimers();
    }
  });

  it("is idempotent: re-running with the same corpus and same today yields a byte-identical SKILL.md", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(TODAY);
      const vault = await mkTempVault();
      created.push(vault);
      await seedProfileAndMove(vault, "profile-x", "move-x");
      await writeClaimFile(vault, {
        id: "claim-1",
        key: "test.k1",
        status: "active",
        confidence: 0.8,
        profile: ["profile-x"],
        move: ["move-x"],
        evidence: ["journal-1"],
        last_validated: "2026-05-01",
      });
      await writeClaimsIndex(vault, await buildClaimsIndex(vault));

      await runSync(vault, "profile-x");
      const first = await fs.readFile(skillPath(vault, "move-x"), "utf8");

      await runSync(vault, "profile-x");
      const second = await fs.readFile(skillPath(vault, "move-x"), "utf8");

      // Byte-identical: marker rendered-date, half-life clause, ranked
      // bullets, and effective confidence all stable under the same `today`.
      expect(second).toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it("respects `claim_render: false` — no block on first sync; removes prior block when flag is added later", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(TODAY);

      // Phase A: opt-out from the start. claim_render: false in the SKILL.md
      // frontmatter means the renderer takes the opt-out branch and writes
      // nothing (or removes any pre-existing markers — none exist here).
      const vaultA = await mkTempVault();
      created.push(vaultA);
      await seedProfileAndMove(vaultA, "profile-x", "move-x", {
        claim_render: false,
      });
      await writeClaimFile(vaultA, {
        id: "claim-1",
        key: "test.k1",
        status: "active",
        confidence: 0.8,
        profile: ["profile-x"],
        move: ["move-x"],
        evidence: ["journal-1"],
        last_validated: "2026-05-01",
      });
      await writeClaimsIndex(vaultA, await buildClaimsIndex(vaultA));

      await runSync(vaultA, "profile-x");

      const skillA = await fs.readFile(skillPath(vaultA, "move-x"), "utf8");
      expect(skillA).not.toContain("<!-- vault-claims:start");
      expect(skillA).not.toContain("## Learned");

      // Phase B: render first, THEN add `claim_render: false` to the
      // frontmatter and re-sync. The next sync's opt-out branch must remove
      // the existing markers + content.
      const vaultB = await mkTempVault();
      created.push(vaultB);
      await seedProfileAndMove(vaultB, "profile-x", "move-x");
      await writeClaimFile(vaultB, {
        id: "claim-1",
        key: "test.k1",
        status: "active",
        confidence: 0.8,
        profile: ["profile-x"],
        move: ["move-x"],
        evidence: ["journal-1"],
        last_validated: "2026-05-01",
      });
      await writeClaimsIndex(vaultB, await buildClaimsIndex(vaultB));

      // First sync renders the block.
      await runSync(vaultB, "profile-x");
      const beforeOptOut = await fs.readFile(skillPath(vaultB, "move-x"), "utf8");
      expect(beforeOptOut).toContain("<!-- vault-claims:start");
      expect(beforeOptOut).toContain("## Learned");

      // Inject `claim_render: false` into the existing frontmatter. Insert
      // BEFORE the closing `---` so YAML stays well-formed. The existing
      // frontmatter from seedProfileAndMove is small and stable; this
      // string-level edit is the simplest hermetic way to mutate it.
      const mutated = beforeOptOut.replace(
        /^---\n([\s\S]*?)\n---/,
        (_m, body) => `---\n${body}\nclaim_render: false\n---`,
      );
      await fs.writeFile(skillPath(vaultB, "move-x"), mutated, "utf8");

      // Sanity: the mutation actually injected the flag.
      const mutatedRead = await fs.readFile(skillPath(vaultB, "move-x"), "utf8");
      expect(mutatedRead).toContain("claim_render: false");
      // Sanity: the rendered block is still there immediately after the
      // mutation (we haven't re-synced yet).
      expect(mutatedRead).toContain("<!-- vault-claims:start");

      // Second sync: opt-out branch must clean up the prior render.
      await runSync(vaultB, "profile-x");
      const afterOptOut = await fs.readFile(skillPath(vaultB, "move-x"), "utf8");
      expect(afterOptOut).not.toContain("<!-- vault-claims:start");
      expect(afterOptOut).not.toContain("<!-- vault-claims:end");
      expect(afterOptOut).not.toContain("## Learned");
      // Frontmatter survived (incl. the opt-out flag itself).
      expect(afterOptOut).toContain("claim_render: false");
    } finally {
      vi.useRealTimers();
    }
  });

  it("respects `claim_render_limit: 2` per-SKILL frontmatter override — caps bullets at 2 with 5 qualifying claims", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(TODAY);
      const vault = await mkTempVault();
      created.push(vault);
      await seedProfileAndMove(vault, "profile-x", "move-x", {
        claim_render_limit: 2,
      });

      // Five active claims for move-x, all above the default
      // render_min_confidence (0.4). Without the override they would all
      // render (default render_default_limit is 10). With the override the
      // top 2 by ranked effective-confidence + boost are kept.
      for (let i = 0; i < 5; i++) {
        await writeClaimFile(vault, {
          id: `claim-${i}`,
          key: `test.k${i}`,
          status: "active",
          // Spread confidence so the ranker has unambiguous order: k0=0.90,
          // k1=0.85, k2=0.80, k3=0.75, k4=0.70. With the deploying-profile
          // boost equal across all (all attribute to profile-x), the top-2
          // are k0 and k1.
          confidence: 0.9 - i * 0.05,
          profile: ["profile-x"],
          move: ["move-x"],
          evidence: [`journal-${i}`],
          last_validated: "2026-05-01",
        });
      }
      await writeClaimsIndex(vault, await buildClaimsIndex(vault));

      await runSync(vault, "profile-x");

      const skillMd = await fs.readFile(skillPath(vault, "move-x"), "utf8");
      // The top two by ranked confidence are present; the other three are
      // dropped because the per-SKILL limit overrides the default.
      expect(skillMd).toContain("**`test.k0`**");
      expect(skillMd).toContain("**`test.k1`**");
      expect(skillMd).not.toContain("**`test.k2`**");
      expect(skillMd).not.toContain("**`test.k3`**");
      expect(skillMd).not.toContain("**`test.k4`**");

      // Belt-and-suspenders: count rendered bullet lines inside the marker
      // block. The block format is `## Learned\n\n- bullet\n- bullet\n...`
      // — exactly 2 bullet lines under the `## Learned` heading.
      const startIdx = skillMd.indexOf("<!-- vault-claims:start");
      const endIdx = skillMd.indexOf("<!-- vault-claims:end");
      expect(startIdx).toBeGreaterThan(-1);
      expect(endIdx).toBeGreaterThan(startIdx);
      const block = skillMd.slice(startIdx, endIdx);
      const bulletLines = block
        .split("\n")
        .filter((l) => /^- \*\*`test\.k\d`\*\*/.test(l));
      expect(bulletLines.length).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes a previously-rendered vault-claims block when the move now has zero qualifying claims", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(TODAY);
      const vault = await mkTempVault();
      created.push(vault);
      await seedProfileAndMove(vault, "profile-x", "move-x");
      await writeClaimFile(vault, {
        id: "claim-1",
        key: "test.k1",
        status: "active",
        confidence: 0.8,
        profile: ["profile-x"],
        move: ["move-x"],
        evidence: ["journal-1"],
        last_validated: "2026-05-01",
      });
      await writeClaimsIndex(vault, await buildClaimsIndex(vault));

      // First sync: renders the block.
      await runSync(vault, "profile-x");
      const before = await fs.readFile(skillPath(vault, "move-x"), "utf8");
      expect(before).toContain("<!-- vault-claims:start");
      expect(before).toContain("## Learned");

      // Retract the claim on disk. Match the JSON.stringify-quoted
      // serialization the writeClaimFile helper uses (`status: "active"`).
      // Same retraction-frontmatter shape used in the Plan-2 sibling
      // synthesize-by-agent-claims.test.ts.
      const claimDir = path.join(vault, "wikis", "_agents", "claim");
      const claimFile = path.join(claimDir, "claim-1.md");
      let raw = await fs.readFile(claimFile, "utf8");
      raw = raw.replace(/status: "active"/, 'status: "retracted"');
      raw = raw.replace(
        /superseded_by: null/,
        'superseded_by: null\nretracted_at: "2026-05-03"\nretracted_by: "agent:test"\nretraction_reason: "test"',
      );
      await fs.writeFile(claimFile, raw, "utf8");

      // Rebuild the sidecar: buildClaimsIndex skips non-active claims, so
      // by_move["move-x"] is now absent.
      await writeClaimsIndex(vault, await buildClaimsIndex(vault));

      // Second sync: zero qualifying claims → the cleanup branch in
      // renderClaimSectionInSkillMd removes the prior block.
      await runSync(vault, "profile-x");
      const after = await fs.readFile(skillPath(vault, "move-x"), "utf8");

      expect(after).not.toContain("<!-- vault-claims:start");
      expect(after).not.toContain("<!-- vault-claims:end");
      expect(after).not.toContain("## Learned");
      // Frontmatter + heading survived.
      expect(after).toContain("# move-x");
    } finally {
      vi.useRealTimers();
    }
  });
});
