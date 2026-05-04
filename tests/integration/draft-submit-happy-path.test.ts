// vault-mcp/tests/integration/draft-submit-happy-path.test.ts
//
// Integration test for the draft-submit happy path per spec §6.2 of
// wikis/_meta/specs/spec-stadium-substrate-fix-and-discovery-design.md.
//
// The full platform test (requires a running stadium-platform instance) is
// gated behind VAULT_RUN_PLATFORM_TESTS=1 to avoid blocking CI. It uses the
// same pattern as pokeapi-network.test.ts.
//
// The A1 regression test (ULID schema fix) runs unconditionally — it verifies
// that valid ULID picks pass schema validation without an HTTP call. This is
// the minimum regression test that would have caught the original A1 blocker
// (pf_-prefixed picks were the old (broken) schema; the fix switches to ULID).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ─── Constants ────────────────────────────────────────────────────────────────

const PLATFORM_TESTS = process.env.VAULT_RUN_PLATFORM_TESTS === "1";

// Six valid ULID-shaped strings for picks (the A1 fix uses /^[0-9A-Z]{26}$/).
const VALID_ULIDS = [
  "01KQT6ST8AHV2XG9JN6QX7H5EX",
  "01KQT6ST8AHV2XG9JN6QX7H5EY",
  "01KQT6ST8AHV2XG9JN6QX7H5EZ",
  "01KQT6ST8AHV2XG9JN6QX7H5FA",
  "01KQT6ST8AHV2XG9JN6QX7H5FB",
  "01KQT6ST8AHV2XG9JN6QX7H5FC",
];

// ─── Schema regression (always runs) ─────────────────────────────────────────
// Catches the original A1 blocker without needing a real platform.

describe("trainer-submit-draft schema — A1 regression (always runs)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    process.env.STADIUM_API_KEY = "sk-test";
    process.env.STADIUM_BASE_URL = "https://api.test";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.STADIUM_API_KEY;
    delete process.env.STADIUM_BASE_URL;
  });

  it("accepts 6 ULID picks (the A1 fix — was pf_-prefixed before)", async () => {
    // Before the fix: picks: z.array(z.string().regex(/^pf_/)).length(6)
    // After the fix:  picks: z.array(z.string().regex(/^[0-9A-Z]{26}$/)).length(6)
    // This test fails with the OLD schema and passes with the NEW schema.
    vi.doMock("../../src/core/resolve-trainer-context.js", () => ({
      resolveTrainerContext: () => ({
        trainerSlug: "trainer1",
        trainerId: "01KQT3E0ABE70N8DMV6EQF1MA0",
        wiki: "_agents",
      }),
    }));
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ match_id: VALID_ULIDS[0], status: "in_progress" }),
          { status: 200 }
        )
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { trainerSubmitDraftTool } = await import(
      "../../src/tools/trainer-submit-draft.js"
    );
    const out = await trainerSubmitDraftTool.handler({
      match_id: "01KQT6ST8AHV2XG9JN6QX7H5EX",
      picks: VALID_ULIDS,
    });

    // The tool must have reached fetch (i.e., schema validation passed)
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((out as any).status).toBe("in_progress");
    expect((out as any).caller_trainer_id).toBe("01KQT3E0ABE70N8DMV6EQF1MA0");
  });

  it("rejects pf_-prefixed picks with INVALID_PICKS_SHAPE (regression pin)", async () => {
    vi.doMock("../../src/core/resolve-trainer-context.js", () => ({
      resolveTrainerContext: () => ({
        trainerSlug: "trainer1",
        trainerId: "01KQT3E0ABE70N8DMV6EQF1MA0",
        wiki: "_agents",
      }),
    }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { trainerSubmitDraftTool } = await import(
      "../../src/tools/trainer-submit-draft.js"
    );
    let caught: unknown;
    try {
      await trainerSubmitDraftTool.handler({
        match_id: "01KQT6ST8AHV2XG9JN6QX7H5EX",
        picks: [
          "pf_aerodactyl",
          "pf_charmeleon",
          "pf_squirtle",
          "pf_bulbasaur",
          "pf_gastly",
          "pf_mewtwo",
        ] as any,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect((caught as any).code).toBe("INVALID_PICKS_SHAPE");
    // Must NOT have reached the platform
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── Full platform happy-path (gated: VAULT_RUN_PLATFORM_TESTS=1) ────────────
//
// Requires a running stadium-platform instance. Set:
//   VAULT_RUN_PLATFORM_TESTS=1
//   STADIUM_TRAINER1_API_KEY=<api key for trainer1>
//   STADIUM_TRAINER1_ID=<ULID for trainer1>
//   STADIUM_TRAINER2_API_KEY=<api key for trainer2>
//   STADIUM_TRAINER2_ID=<ULID for trainer2>
//   STADIUM_PLATFORM_URL=http://localhost:3000
//
// How the test works:
//   1. Sets up a vault fixture with two trainer pages (trainer1, trainer2)
//      and 6 profile pages each (12 total), pre-seeded with platform_profile_id
//      from a prior profile-register call (or provided via env).
//   2. Calls vault.trainer-queue-match as trainer1 against trainer2.
//   3. Calls vault.trainer-accept-match as trainer2.
//   4. During drafting phase, calls vault.trainer-get-state as trainer1 and
//      verifies: status === "drafting", available_profiles present,
//      caller_trainer_id === trainer1.trainerId, caller_side set.
//   5. Both trainers submit 6 picks via vault.trainer-submit-draft.
//   6. Calls vault.trainer-get-state as trainer1; expects status !== "drafting"
//      and available_profiles absent.
//   7. Calls vault.trainer-get-state as trainer2; validates caller_side.

describe.skipIf(!PLATFORM_TESTS)(
  "draft-submit happy path e2e (requires VAULT_RUN_PLATFORM_TESTS=1)",
  () => {
    let vaultPath: string;
    let homeT1: string;
    let homeT2: string;

    const platformUrl =
      process.env.STADIUM_PLATFORM_URL ?? "http://localhost:3000";
    const trainer1Id =
      process.env.STADIUM_TRAINER1_ID ?? "";
    const trainer1ApiKey =
      process.env.STADIUM_TRAINER1_API_KEY ?? "";
    const trainer2Id =
      process.env.STADIUM_TRAINER2_ID ?? "";
    const trainer2ApiKey =
      process.env.STADIUM_TRAINER2_API_KEY ?? "";

    // Profile IDs on the platform — callers register before running this suite,
    // OR pass pre-registered IDs via env (comma-separated, 6 per trainer).
    const profiles1Raw =
      process.env.STADIUM_TRAINER1_PROFILE_IDS ?? "";
    const profiles2Raw =
      process.env.STADIUM_TRAINER2_PROFILE_IDS ?? "";

    beforeEach(() => {
      vi.resetModules();
      vi.unstubAllGlobals();

      vaultPath = mkdtempSync(join(tmpdir(), "vault-e2e-draft-"));
      homeT1 = mkdtempSync(join(tmpdir(), "vault-e2e-home-t1-"));
      homeT2 = mkdtempSync(join(tmpdir(), "vault-e2e-home-t2-"));

      // Minimal vault skeleton
      mkdirSync(join(vaultPath, "_index"), { recursive: true });
      mkdirSync(
        join(vaultPath, "wikis", "_agents", "trainers"),
        { recursive: true }
      );
      mkdirSync(
        join(vaultPath, "wikis", "_agents", "profiles"),
        { recursive: true }
      );

      // _index/wikis.json (needed by loadTrainerPages)
      writeFileSync(
        join(vaultPath, "_index", "wikis.json"),
        JSON.stringify({
          wikis: [
            {
              name: "_agents",
              mode: "mixed",
              scope: "private",
              description: "",
              page_counts: {},
              last_touched: "2026-05-04",
            },
          ],
        })
      );
      writeFileSync(
        join(vaultPath, "_index", "pages.json"),
        JSON.stringify({ pages: [] })
      );
      writeFileSync(
        join(vaultPath, "_index", "tokens.json"),
        JSON.stringify({})
      );
      writeFileSync(
        join(vaultPath, "_index", "links.json"),
        JSON.stringify({})
      );

      // Trainer pages
      writeTrainerPage(vaultPath, "trainer1", trainer1Id);
      writeTrainerPage(vaultPath, "trainer2", trainer2Id);

      // stadium.toml for trainer1 home
      writeStadiumToml(homeT1, "trainer1", trainer1ApiKey, platformUrl);
      // stadium.toml for trainer2 home
      writeStadiumToml(homeT2, "trainer2", trainer2ApiKey, platformUrl);

      // Profile pages for trainer1 (6 profiles with platform_profile_id pre-set)
      if (profiles1Raw) {
        const ids = profiles1Raw.split(",").map((s) => s.trim());
        ids.forEach((pid, i) =>
          writeProfilePage(vaultPath, `profile-t1-${i}`, pid, trainer1Id)
        );
      }

      // Profile pages for trainer2
      if (profiles2Raw) {
        const ids = profiles2Raw.split(",").map((s) => s.trim());
        ids.forEach((pid, i) =>
          writeProfilePage(vaultPath, `profile-t2-${i}`, pid, trainer2Id)
        );
      }

      process.env.VAULT_PATH = vaultPath;
    });

    afterEach(() => {
      rmSync(vaultPath, { recursive: true, force: true });
      rmSync(homeT1, { recursive: true, force: true });
      rmSync(homeT2, { recursive: true, force: true });
      delete process.env.VAULT_PATH;
      delete process.env.STADIUM_HOME;
    });

    it(
      "two trainers complete draft and enter in_progress without curl bypass",
      { timeout: 30_000 },
      async () => {
        // Validate required env
        expect(trainer1Id, "STADIUM_TRAINER1_ID must be set").not.toBe("");
        expect(trainer1ApiKey, "STADIUM_TRAINER1_API_KEY must be set").not.toBe("");
        expect(trainer2Id, "STADIUM_TRAINER2_ID must be set").not.toBe("");
        expect(trainer2ApiKey, "STADIUM_TRAINER2_API_KEY must be set").not.toBe("");
        expect(profiles1Raw, "STADIUM_TRAINER1_PROFILE_IDS must be set").not.toBe("");
        expect(profiles2Raw, "STADIUM_TRAINER2_PROFILE_IDS must be set").not.toBe("");

        const picks1 = profiles1Raw.split(",").map((s) => s.trim());
        const picks2 = profiles2Raw.split(",").map((s) => s.trim());
        expect(picks1.length).toBe(6);
        expect(picks2.length).toBe(6);

        // ── Step 1: trainer1 queues match ─────────────────────────────────────
        process.env.STADIUM_HOME = homeT1;
        // reset module cache so resolveTrainerContext picks up homeT1
        vi.resetModules();
        const { trainerQueueMatchTool } = await import(
          "../../src/tools/trainer-queue-match.js"
        );
        const queueResult = await trainerQueueMatchTool.handler({
          opponent_trainer_id: trainer2Id,
          ruleset: "standard",
        });
        const matchId = (queueResult as any).match_id as string;
        expect(matchId).toMatch(/^[0-9A-Z]{26}$/);
        expect((queueResult as any).caller_trainer_id).toBe(trainer1Id);

        // ── Step 2: trainer2 accepts ──────────────────────────────────────────
        process.env.STADIUM_HOME = homeT2;
        vi.resetModules();
        const { trainerAcceptMatchTool } = await import(
          "../../src/tools/trainer-accept-match.js"
        );
        const acceptResult = await trainerAcceptMatchTool.handler({
          match_id: matchId,
        });
        expect((acceptResult as any).caller_trainer_id).toBe(trainer2Id);

        // ── Step 3: trainer1 checks state (drafting) ──────────────────────────
        process.env.STADIUM_HOME = homeT1;
        vi.resetModules();
        const { trainerGetStateTool: getStateT1Before } = await import(
          "../../src/tools/trainer-get-state.js"
        );
        const stateBeforeT1 = await getStateT1Before.handler({ match_id: matchId });
        expect((stateBeforeT1 as any).status).toBe("drafting");
        expect((stateBeforeT1 as any).caller_trainer_id).toBe(trainer1Id);
        expect((stateBeforeT1 as any).caller_side).toMatch(/^[ab]$/);
        expect((stateBeforeT1 as any).available_profiles).toBeDefined();
        expect(Array.isArray((stateBeforeT1 as any).available_profiles)).toBe(true);

        // ── Step 4: trainer1 submits draft ────────────────────────────────────
        vi.resetModules();
        const { trainerSubmitDraftTool: submitT1 } = await import(
          "../../src/tools/trainer-submit-draft.js"
        );
        const draftResult1 = await submitT1.handler({
          match_id: matchId,
          picks: picks1,
        });
        expect((draftResult1 as any).caller_trainer_id).toBe(trainer1Id);

        // ── Step 5: trainer2 submits draft ────────────────────────────────────
        process.env.STADIUM_HOME = homeT2;
        vi.resetModules();
        const { trainerSubmitDraftTool: submitT2 } = await import(
          "../../src/tools/trainer-submit-draft.js"
        );
        const draftResult2 = await submitT2.handler({
          match_id: matchId,
          picks: picks2,
        });
        expect((draftResult2 as any).caller_trainer_id).toBe(trainer2Id);

        // ── Step 6: trainer1 checks state — should have moved past drafting ───
        process.env.STADIUM_HOME = homeT1;
        vi.resetModules();
        const { trainerGetStateTool: getStateT1After } = await import(
          "../../src/tools/trainer-get-state.js"
        );
        const stateAfterT1 = await getStateT1After.handler({ match_id: matchId });

        // After both drafts, status must not be "drafting"
        expect((stateAfterT1 as any).status).not.toBe("drafting");
        // available_profiles must be absent outside drafting
        expect((stateAfterT1 as any).available_profiles).toBeUndefined();
        expect((stateAfterT1 as any).caller_trainer_id).toBe(trainer1Id);
        expect((stateAfterT1 as any).caller_side).toMatch(/^[ab]$/);
        expect(typeof (stateAfterT1 as any).waiting_for_move).toBe("boolean");

        const t1Side = (stateAfterT1 as any).caller_side as "a" | "b";

        // ── Step 7: trainer2 checks state — caller_side is the other side ─────
        process.env.STADIUM_HOME = homeT2;
        vi.resetModules();
        const { trainerGetStateTool: getStateT2 } = await import(
          "../../src/tools/trainer-get-state.js"
        );
        const stateAfterT2 = await getStateT2.handler({ match_id: matchId });
        expect((stateAfterT2 as any).caller_trainer_id).toBe(trainer2Id);
        const t2Side = (stateAfterT2 as any).caller_side as "a" | "b";
        expect(t2Side).not.toBe(t1Side); // trainer1 and trainer2 are on opposite sides
      }
    );
  }
);

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function writeTrainerPage(
  vaultPath: string,
  slug: string,
  trainerId: string
): void {
  writeFileSync(
    join(vaultPath, "wikis", "_agents", "trainers", `trainer-${slug}.md`),
    [
      "---",
      `id: trainer-${slug}`,
      "type: trainer",
      `title: "Trainer ${slug}"`,
      `trainer_id: ${trainerId}`,
      `trainer_slug: ${slug}`,
      "wiki: _agents",
      "status: active",
      "created: 2026-05-04",
      "---",
      `# Trainer ${slug}`,
    ].join("\n")
  );
}

function writeStadiumToml(
  homePath: string,
  slug: string,
  apiKey: string,
  baseUrl: string
): void {
  mkdirSync(join(homePath, ".vault"), { recursive: true });
  writeFileSync(
    join(homePath, ".vault", "stadium.toml"),
    [
      `active = "${slug}"`,
      "",
      `[trainer.${slug}]`,
      `api_key = "${apiKey}"`,
      `base_url = "${baseUrl}"`,
    ].join("\n"),
    "utf8"
  );
}

function writeProfilePage(
  vaultPath: string,
  profileId: string,
  platformProfileId: string,
  ownerTrainerId: string
): void {
  writeFileSync(
    join(
      vaultPath,
      "wikis",
      "_agents",
      "profiles",
      `${profileId}.md`
    ),
    [
      "---",
      `id: ${profileId}`,
      "type: profile",
      `title: "${profileId}"`,
      "wiki: _agents",
      "status: active",
      "created: 2026-05-04",
      "pokemon: charmander",
      "evolution_stage: basic",
      `platform_profile_id: ${platformProfileId}`,
      `owner_trainer_id: ${ownerTrainerId}`,
      "moveset: []",
      "summary: test profile",
      "---",
    ].join("\n")
  );
}
