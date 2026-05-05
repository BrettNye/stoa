import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listPlatformProfiles } from "../../src/tools/list-platform-profiles.js";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeTempVault(): string {
  const vaultPath = join(
    tmpdir(),
    `vault-list-platform-profiles-${Date.now()}-${Math.random()}`
  );
  mkdirSync(join(vaultPath, "_index"), { recursive: true });
  mkdirSync(join(vaultPath, "wikis", "_agents", "profiles"), { recursive: true });
  mkdirSync(join(vaultPath, "wikis", "_agents", "trainers"), { recursive: true });
  mkdirSync(join(vaultPath, "wikis", "_agents", "moves"), { recursive: true });
  // Write a minimal wikis.json
  writeFileSync(
    join(vaultPath, "_index", "wikis.json"),
    JSON.stringify({
      wikis: [{ name: "_agents", mode: "mixed", scope: "agents", page_counts: {}, last_touched: "2026-05-04" }],
    }),
    "utf8"
  );
  return vaultPath;
}

function writeProfileFile(
  vaultPath: string,
  wiki: string,
  id: string,
  fields: Record<string, unknown>,
  moveset?: string[]
) {
  const fm = Object.entries({ id, type: "profile", wiki, status: "active", created: "2026-05-04", ...fields })
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}:\n${v.map((i) => `  - ${i}`).join("\n")}`;
      return `${k}: ${JSON.stringify(v)}`;
    })
    .join("\n");
  const profilesDir = join(vaultPath, "wikis", wiki, "profiles");
  mkdirSync(profilesDir, { recursive: true });
  writeFileSync(
    join(profilesDir, `${id}.md`),
    `---\n${fm}\n${moveset ? `moveset:\n${moveset.map((m) => `  - ${m}`).join("\n")}\n` : ""}---\nBody.\n`,
    "utf8"
  );
}

function writeMoveFile(
  vaultPath: string,
  wiki: string,
  moveId: string,
  fields: Record<string, unknown>
) {
  const moveDir = join(vaultPath, "wikis", wiki, "moves", moveId);
  mkdirSync(moveDir, { recursive: true });
  const fm = Object.entries({ id: moveId, type: "move", wiki, status: "active", created: "2026-05-04", ...fields })
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");
  writeFileSync(join(moveDir, "SKILL.md"), `---\n${fm}\n---\nBody.\n`, "utf8");
}

function writeTrainerFile(
  vaultPath: string,
  wiki: string,
  slug: string,
  trainerId: string
) {
  const trainersDir = join(vaultPath, "wikis", wiki, "trainers");
  mkdirSync(trainersDir, { recursive: true });
  writeFileSync(
    join(trainersDir, `trainer-${slug}.md`),
    `---\nid: "trainer-${slug}"\ntype: "trainer"\ntitle: "Trainer ${slug}"\ntrainer_id: "${trainerId}"\ntrainer_slug: "${slug}"\nwiki: "${wiki}"\nstatus: "active"\ncreated: "2026-05-04"\n---\n\nBody.\n`,
    "utf8"
  );
}

function writeWikisIndex(vaultPath: string, wikis: string[]) {
  writeFileSync(
    join(vaultPath, "_index", "wikis.json"),
    JSON.stringify({
      wikis: wikis.map((name) => ({
        name,
        mode: "mixed",
        scope: "test",
        page_counts: {},
        last_touched: "2026-05-04",
      })),
    }),
    "utf8"
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("listPlatformProfiles", () => {
  let vaultPath: string;
  const OLD_ENV = process.env;

  beforeEach(() => {
    vaultPath = makeTempVault();
    process.env = { ...OLD_ENV };
    // Point STOA_VAULT_PATH at our temp vault
    process.env.STOA_VAULT_PATH = vaultPath;
    // Ensure no STADIUM_TRAINER env bleed
    delete process.env.STADIUM_TRAINER;
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    process.env = OLD_ENV;
  });

  // ─── Core: only profiles with platform_profile_id are returned ───────────

  it("returns only profiles with platform_profile_id set", async () => {
    // Two profiles WITH platform_profile_id
    writeProfileFile(vaultPath, "_agents", "profile-charmander", {
      title: "Charmander",
      pokemon: "charmander",
      evolution_stage: "basic",
      platform_profile_id: "01KQTPPPPPPPPPPPPPPPPPPPP1",
      owner_trainer_id: "01KQTTTTTTTTTTTTTTTTTTTTT1",
      summary: "fire",
    });
    writeProfileFile(vaultPath, "_agents", "profile-squirtle", {
      title: "Squirtle",
      pokemon: "squirtle",
      evolution_stage: "basic",
      platform_profile_id: "01KQTPPPPPPPPPPPPPPPPPPPP2",
      owner_trainer_id: "01KQTTTTTTTTTTTTTTTTTTTTT2",
      summary: "water",
    });
    // One profile WITHOUT platform_profile_id
    writeProfileFile(vaultPath, "_agents", "profile-bulbasaur", {
      title: "Bulbasaur",
      pokemon: "bulbasaur",
      evolution_stage: "basic",
      summary: "grass",
      // No platform_profile_id
    });

    // Need a trainer context — set via env
    writeTrainerFile(vaultPath, "_agents", "test-trainer", "01KQTTTTTTTTTTTTTTTTTTTTT1");
    process.env.STADIUM_TRAINER = "test-trainer";
    writeWikisIndex(vaultPath, ["_agents"]);

    const result = await listPlatformProfiles({ wiki: "_agents" });

    expect(result.profiles).toHaveLength(2);
    expect(result.profiles.every((p) => /^[0-9A-Z]{26}$/.test(p.platform_profile_id))).toBe(true);
  });

  it("each row contains all required fields", async () => {
    writeProfileFile(vaultPath, "_agents", "profile-pikachu", {
      title: "Pikachu",
      pokemon: "pikachu",
      evolution_stage: "basic",
      platform_profile_id: "01KQTPPPPPPPPPPPPPPPPPPPPA",
      owner_trainer_id: "01KQTTTTTTTTTTTTTTTTTTTTTA",
      summary: "electric",
    });
    writeTrainerFile(vaultPath, "_agents", "t1", "01KQTTTTTTTTTTTTTTTTTTTTTA");
    process.env.STADIUM_TRAINER = "t1";
    writeWikisIndex(vaultPath, ["_agents"]);

    const result = await listPlatformProfiles({ wiki: "_agents" });

    expect(result.profiles).toHaveLength(1);
    const p = result.profiles[0];
    expect(p.platform_profile_id).toBe("01KQTPPPPPPPPPPPPPPPPPPPPA");
    expect(p.pokemon).toBe("pikachu");
    expect(p.owner_trainer_id).toBe("01KQTTTTTTTTTTTTTTTTTTTTTA");
    expect(p.profile_page_id).toBe("profile-pikachu");
    expect(p.wiki).toBe("_agents");
    expect(p.real_skill_levels).toEqual({});
  });

  // ─── real_skill_levels populated when moves have real_skill_id ────────────

  it("populates real_skill_levels from move files with real_skill_id", async () => {
    writeMoveFile(vaultPath, "_agents", "move-tdd-cycle", {
      real_skill_id: "01KQTRRRRRRRRRRRRRRRRRRRR1",
    });
    writeMoveFile(vaultPath, "_agents", "move-pr-create", {
      // No real_skill_id — should be omitted
    });
    writeProfileFile(
      vaultPath,
      "_agents",
      "profile-charmeleon",
      {
        title: "Charmeleon",
        pokemon: "charmeleon",
        evolution_stage: "stage1",
        platform_profile_id: "01KQTPPPPPPPPPPPPPPPPPPPPC",
        owner_trainer_id: "01KQTTTTTTTTTTTTTTTTTTTTTC",
        summary: "fire evolved",
      },
      ["move-tdd-cycle", "move-pr-create"]
    );
    writeTrainerFile(vaultPath, "_agents", "tc", "01KQTTTTTTTTTTTTTTTTTTTTTC");
    process.env.STADIUM_TRAINER = "tc";
    writeWikisIndex(vaultPath, ["_agents"]);

    const result = await listPlatformProfiles({ wiki: "_agents" });
    expect(result.profiles).toHaveLength(1);
    const p = result.profiles[0];
    // Key is real_skill_id (platform identifier), NOT moveId (vault concept).
    // move-tdd-cycle has real_skill_id "01KQTRRRRRRRRRRRRRRRRRRRR1"; move-pr-create has none.
    expect(p.real_skill_levels).toHaveProperty("01KQTRRRRRRRRRRRRRRRRRRRR1");
    expect(typeof p.real_skill_levels["01KQTRRRRRRRRRRRRRRRRRRRR1"]).toBe("number");
    // move-pr-create had no real_skill_id so it should not appear
    expect(Object.keys(p.real_skill_levels)).toHaveLength(1);
  });

  it("returns empty real_skill_levels when profile has no moves", async () => {
    writeProfileFile(vaultPath, "_agents", "profile-mewtwo", {
      title: "Mewtwo",
      pokemon: "mewtwo",
      evolution_stage: "stage2",
      platform_profile_id: "01KQTPPPPPPPPPPPPPPPPPPPPM",
      owner_trainer_id: "01KQTTTTTTTTTTTTTTTTTTTTTM",
      summary: "psychic legend",
      // No moveset
    });
    writeTrainerFile(vaultPath, "_agents", "tm", "01KQTTTTTTTTTTTTTTTTTTTTTM");
    process.env.STADIUM_TRAINER = "tm";
    writeWikisIndex(vaultPath, ["_agents"]);

    const result = await listPlatformProfiles({ wiki: "_agents" });
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0].real_skill_levels).toEqual({});
  });

  // ─── owner_trainer_id filter ──────────────────────────────────────────────

  it("filters by owner_trainer_id when provided", async () => {
    const trainerId1 = "01KQTTTTTTTTTTTTTTTTTTTTT1";
    const trainerId2 = "01KQTTTTTTTTTTTTTTTTTTTTT2";
    writeProfileFile(vaultPath, "_agents", "profile-a", {
      title: "A",
      pokemon: "charmander",
      evolution_stage: "basic",
      platform_profile_id: "01KQTPPPPPPPPPPPPPPPPPPPPF",
      owner_trainer_id: trainerId1,
      summary: "owned by 1",
    });
    writeProfileFile(vaultPath, "_agents", "profile-b", {
      title: "B",
      pokemon: "squirtle",
      evolution_stage: "basic",
      platform_profile_id: "01KQTPPPPPPPPPPPPPPPPPPPPG",
      owner_trainer_id: trainerId2,
      summary: "owned by 2",
    });
    writeTrainerFile(vaultPath, "_agents", "tfilter", trainerId1);
    process.env.STADIUM_TRAINER = "tfilter";
    writeWikisIndex(vaultPath, ["_agents"]);

    const result = await listPlatformProfiles({
      wiki: "_agents",
      owner_trainer_id: trainerId1,
    });

    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0].owner_trainer_id).toBe(trainerId1);
  });

  // ─── wiki: arg overrides resolved trainer's wiki ─────────────────────────

  it("wiki arg overrides resolved trainer wiki", async () => {
    // Trainer is in _agents wiki; profiles are in a different wiki
    writeTrainerFile(vaultPath, "_agents", "crosswiki-trainer", "01KQTTTTTTTTTTTTTTTTTTTTT9");
    process.env.STADIUM_TRAINER = "crosswiki-trainer";

    // Create a second wiki with profiles
    mkdirSync(join(vaultPath, "wikis", "alpha", "profiles"), { recursive: true });
    writeProfileFile(vaultPath, "alpha", "profile-gengar", {
      title: "Gengar",
      pokemon: "gengar",
      evolution_stage: "stage1",
      platform_profile_id: "01KQTPPPPPPPPPPPPPPPPPPPPH",
      owner_trainer_id: "01KQTTTTTTTTTTTTTTTTTTTTT9",
      summary: "ghost type",
    });
    writeWikisIndex(vaultPath, ["_agents", "alpha"]);

    // Explicit wiki: "alpha" overrides resolved wiki "_agents"
    const result = await listPlatformProfiles({ wiki: "alpha" });
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0].wiki).toBe("alpha");
  });

  // ─── caller_trainer_id ────────────────────────────────────────────────────

  it("returns ambient caller_trainer_id from resolveTrainerContext", async () => {
    const expectedTrainerId = "01KQTTTTTTTTTTTTTTTTTTTTT5";
    writeTrainerFile(vaultPath, "_agents", "caller-trainer", expectedTrainerId);
    process.env.STADIUM_TRAINER = "caller-trainer";
    writeWikisIndex(vaultPath, ["_agents"]);

    const result = await listPlatformProfiles({ wiki: "_agents" });
    expect(result.caller_trainer_id).toBe(expectedTrainerId);
  });

  // ─── empty wiki returns empty profiles list ───────────────────────────────

  it("returns empty profiles list when wiki has no profiles dir", async () => {
    // No profiles dir in this wiki
    writeTrainerFile(vaultPath, "_agents", "empty-trainer", "01KQTTTTTTTTTTTTTTTTTTTTTE");
    process.env.STADIUM_TRAINER = "empty-trainer";
    writeWikisIndex(vaultPath, ["_agents"]);

    // Create a different wiki with no profiles
    mkdirSync(join(vaultPath, "wikis", "empty-wiki"), { recursive: true });
    writeWikisIndex(vaultPath, ["_agents", "empty-wiki"]);

    const result = await listPlatformProfiles({ wiki: "empty-wiki" });
    expect(result.profiles).toEqual([]);
  });

  // ─── STOA_VAULT_PATH env var is honored (not legacy VAULT_PATH) ──────────

  it("reads vault path from STOA_VAULT_PATH env var (not VAULT_PATH)", async () => {
    writeProfileFile(vaultPath, "_agents", "profile-stoa-check", {
      title: "Stoa Check",
      pokemon: "eevee",
      evolution_stage: "basic",
      platform_profile_id: "01KQTPPPPPPPPPPPPPPPPPPPPS",
      owner_trainer_id: "01KQTTTTTTTTTTTTTTTTTTTSTS",
      summary: "stoa env check",
    });
    writeTrainerFile(vaultPath, "_agents", "stoa-trainer", "01KQTTTTTTTTTTTTTTTTTTTSTS");
    process.env.STADIUM_TRAINER = "stoa-trainer";
    writeWikisIndex(vaultPath, ["_agents"]);

    // Use STOA_VAULT_PATH, NOT VAULT_PATH
    delete process.env.VAULT_PATH;
    process.env.STOA_VAULT_PATH = vaultPath;

    const result = await listPlatformProfiles({ wiki: "_agents" });
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0].platform_profile_id).toBe("01KQTPPPPPPPPPPPPPPPPPPPPS");
  });
});
