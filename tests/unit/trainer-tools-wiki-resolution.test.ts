/**
 * Tests for wiki resolution and caller_trainer_id injection in:
 *   - trainer-queue-match
 *   - trainer-accept-match
 *   - trainer-init
 *
 * Per spec §1.5 and §2 of spec-stadium-substrate-fix-and-discovery-design.md:
 *   - trainer-queue-match and trainer-accept-match resolve wiki via resolveTrainerContext
 *   - explicit wiki: arg wins over trainer's frontmatter wiki
 *   - caller_trainer_id is included in all responses
 *   - TRAINER_WIKI_UNSET thrown when no wiki resolvable
 *   - trainer-init handles first-time-init gracefully (caller_trainer_id: null)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  mkdtempSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeTempDirs() {
  const home = mkdtempSync(join(tmpdir(), "vault-trainer-tools-home-"));
  const vault = mkdtempSync(join(tmpdir(), "vault-trainer-tools-vault-"));
  mkdirSync(join(home, ".vault"), { recursive: true });
  mkdirSync(join(vault, "wikis", "_agents", "trainers"), { recursive: true });
  mkdirSync(join(vault, "_index"), { recursive: true });
  return { home, vault };
}

function writeToml(home: string, content: string) {
  writeFileSync(join(home, ".vault", "stadium.toml"), content, "utf8");
}

/**
 * Writes a full toml with the trainer as active, including a [trainer.<slug>] section
 * so resolveStadiumConfig doesn't throw StadiumTrainerNotFoundError.
 */
function writeTomlWithTrainer(home: string, slug: string, trainerId: string, apiKey = "sk_test") {
  const content = [
    `active = "${slug}"`,
    ``,
    `[trainer.${slug}]`,
    `trainer_id = "${trainerId}"`,
    `api_key = "${apiKey}"`,
    `base_url = "https://api.test"`,
    ``
  ].join("\n");
  writeToml(home, content);
}

function writeWikisIndex(vault: string, wikis: string[]) {
  const wikisJson = {
    wikis: wikis.map((name) => ({
      name,
      mode: "mixed",
      scope: "test",
      page_counts: {},
      last_touched: "2026-01-01",
    })),
  };
  writeFileSync(
    join(vault, "_index", "wikis.json"),
    JSON.stringify(wikisJson),
    "utf8"
  );
}

function writeTrainerPage(
  vault: string,
  wiki: string,
  slug: string,
  trainerId: string,
  wikiField?: string
) {
  mkdirSync(join(vault, "wikis", wiki, "trainers"), { recursive: true });
  const fmFields: string[] = [
    `id: "trainer-${slug}"`,
    `type: "trainer"`,
    `title: "Trainer ${slug}"`,
    `trainer_id: "${trainerId}"`,
    `trainer_slug: "${slug}"`,
    `status: "active"`,
    `created: "2026-05-04"`,
  ];
  if (wikiField !== undefined) {
    fmFields.push(`wiki: "${wikiField}"`);
  }
  const content = `---\n${fmFields.join("\n")}\n---\n\nBody text.\n`;
  writeFileSync(
    join(vault, "wikis", wiki, "trainers", `trainer-${slug}.md`),
    content,
    "utf8"
  );
}

// Stub fetch to return a successful match response
function makeFetchMock(response: unknown, status = 200) {
  return vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify(response), { status })
    )
  );
}

// ─── trainer-queue-match ─────────────────────────────────────────────────────

describe("trainer-queue-match wiki resolution", () => {
  let home: string;
  let vault: string;

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    ({ home, vault } = makeTempDirs());
    delete process.env.STADIUM_TRAINER;
    process.env.VAULT_PATH = vault;
    process.env.STADIUM_HOME = home;
    // These env vars serve as fallback for resolveStadiumConfig when no toml section found
    process.env.STADIUM_API_KEY = "sk_test";
    process.env.STADIUM_BASE_URL = "https://api.test";
    process.env.STADIUM_TRAINER_ID = "trn_test_caller";
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(vault, { recursive: true, force: true });
    delete process.env.STADIUM_TRAINER;
    delete process.env.VAULT_PATH;
    delete process.env.STADIUM_HOME;
  });

  it("includes caller_trainer_id in successful response", async () => {
    // writeTomlWithTrainer so resolveStadiumConfig finds the [trainer.*] section
    writeTomlWithTrainer(home, "brett-trainer1", "01KQT3E0ABE70N8DMV6EQF1MA0");
    writeWikisIndex(vault, ["_agents"]);
    writeTrainerPage(vault, "_agents", "brett-trainer1", "01KQT3E0ABE70N8DMV6EQF1MA0", "_agents");

    const fetchMock = makeFetchMock({ match_id: "m_99", status: "pending_invite" });
    vi.stubGlobal("fetch", fetchMock);
    const { trainerQueueMatchTool } = await import("../../src/tools/trainer-queue-match.js");

    const out = await trainerQueueMatchTool.handler({
      opponent_trainer_id: "trn_bob",
      ruleset: "standard",
    });

    expect(out).toHaveProperty("match_id", "m_99");
    expect(out).toHaveProperty("caller_trainer_id");
    expect(typeof out.caller_trainer_id).toBe("string");
    expect(out.caller_trainer_id).toBe("01KQT3E0ABE70N8DMV6EQF1MA0");
  });

  it("resolves wiki from active trainer frontmatter, not a hardcoded default", async () => {
    // writeTomlWithTrainer so resolveStadiumConfig finds the [trainer.*] section
    writeTomlWithTrainer(home, "brett-trainer1", "01KQT3E0ABE70N8DMV6EQF1MA0");
    writeWikisIndex(vault, ["_agents", "alpha"]);
    // Trainer lives in _agents wiki (not alpha)
    writeTrainerPage(vault, "_agents", "brett-trainer1", "01KQT3E0ABE70N8DMV6EQF1MA0", "_agents");

    const fetchMock = makeFetchMock({ match_id: "m_99", status: "pending_invite" });
    vi.stubGlobal("fetch", fetchMock);
    const { trainerQueueMatchTool } = await import("../../src/tools/trainer-queue-match.js");

    const out = await trainerQueueMatchTool.handler({
      opponent_trainer_id: "trn_bob",
      ruleset: "standard",
    });

    // Response should include caller_trainer_id from the resolved trainer
    expect(out.caller_trainer_id).toBe("01KQT3E0ABE70N8DMV6EQF1MA0");
  });

  it("throws TRAINER_WIKI_UNSET when trainer has no wiki field and no explicit wiki arg", async () => {
    // Use toml with active + trainer section; trainer page has no wiki: field
    writeTomlWithTrainer(home, "no-wiki-trainer", "01AAAAAAAAAAAAAAAAAAAAAAAA1");
    writeWikisIndex(vault, ["_agents"]);
    writeTrainerPage(vault, "_agents", "no-wiki-trainer", "01AAAAAAAAAAAAAAAAAAAAAAAA1", undefined);

    const fetchMock = makeFetchMock({ match_id: "m_99", status: "pending_invite" });
    vi.stubGlobal("fetch", fetchMock);
    const { trainerQueueMatchTool } = await import("../../src/tools/trainer-queue-match.js");

    await expect(
      trainerQueueMatchTool.handler({ opponent_trainer_id: "trn_bob", ruleset: "standard" })
    ).rejects.toMatchObject({ code: "TRAINER_WIKI_UNSET" });
  });

  it("throws NO_ACTIVE_TRAINER when no trainer is configured", async () => {
    // No toml, no env STADIUM_TRAINER → resolveTrainerContext throws NO_ACTIVE_TRAINER
    delete process.env.STADIUM_TRAINER;
    // Note: no toml written — home dir has .vault/ but no stadium.toml

    const fetchMock = makeFetchMock({ match_id: "m_99", status: "pending_invite" });
    vi.stubGlobal("fetch", fetchMock);
    const { trainerQueueMatchTool } = await import("../../src/tools/trainer-queue-match.js");

    await expect(
      trainerQueueMatchTool.handler({ opponent_trainer_id: "trn_bob", ruleset: "standard" })
    ).rejects.toMatchObject({ code: "NO_ACTIVE_TRAINER" });
  });
});

// ─── trainer-accept-match ────────────────────────────────────────────────────

describe("trainer-accept-match wiki resolution", () => {
  let home: string;
  let vault: string;

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    ({ home, vault } = makeTempDirs());
    delete process.env.STADIUM_TRAINER;
    process.env.VAULT_PATH = vault;
    process.env.STADIUM_HOME = home;
    process.env.STADIUM_API_KEY = "sk_test";
    process.env.STADIUM_BASE_URL = "https://api.test";
    process.env.STADIUM_TRAINER_ID = "trn_test_caller";
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(vault, { recursive: true, force: true });
    delete process.env.STADIUM_TRAINER;
    delete process.env.VAULT_PATH;
    delete process.env.STADIUM_HOME;
  });

  it("includes caller_trainer_id in successful response", async () => {
    writeTomlWithTrainer(home, "brett-trainer1", "01KQT3E0ABE70N8DMV6EQF1MA0");
    writeWikisIndex(vault, ["_agents"]);
    writeTrainerPage(vault, "_agents", "brett-trainer1", "01KQT3E0ABE70N8DMV6EQF1MA0", "_agents");

    const fetchMock = makeFetchMock({ match_id: "m_1", status: "drafting" });
    vi.stubGlobal("fetch", fetchMock);
    const { trainerAcceptMatchTool } = await import("../../src/tools/trainer-accept-match.js");

    const out = await trainerAcceptMatchTool.handler({ match_id: "m_1" });

    expect(out).toHaveProperty("match_id", "m_1");
    expect(out).toHaveProperty("caller_trainer_id");
    expect(out.caller_trainer_id).toBe("01KQT3E0ABE70N8DMV6EQF1MA0");
  });

  it("resolves wiki from active trainer, not a hardcoded default", async () => {
    writeTomlWithTrainer(home, "brett-trainer2", "01KQT3E0TRAINER2IDXXXXXXXXX");
    writeWikisIndex(vault, ["_agents"]);
    writeTrainerPage(vault, "_agents", "brett-trainer2", "01KQT3E0TRAINER2IDXXXXXXXXX", "_agents");

    const fetchMock = makeFetchMock({ match_id: "m_1", status: "drafting" });
    vi.stubGlobal("fetch", fetchMock);
    const { trainerAcceptMatchTool } = await import("../../src/tools/trainer-accept-match.js");

    const out = await trainerAcceptMatchTool.handler({ match_id: "m_1" });
    expect(out.caller_trainer_id).toBe("01KQT3E0TRAINER2IDXXXXXXXXX");
  });

  it("throws TRAINER_WIKI_UNSET when trainer has no wiki field", async () => {
    writeTomlWithTrainer(home, "no-wiki-trainer", "01AAAAAAAAAAAAAAAAAAAAAAAA1");
    writeWikisIndex(vault, ["_agents"]);
    writeTrainerPage(vault, "_agents", "no-wiki-trainer", "01AAAAAAAAAAAAAAAAAAAAAAAA1", undefined);

    const fetchMock = makeFetchMock({ match_id: "m_1", status: "drafting" });
    vi.stubGlobal("fetch", fetchMock);
    const { trainerAcceptMatchTool } = await import("../../src/tools/trainer-accept-match.js");

    await expect(
      trainerAcceptMatchTool.handler({ match_id: "m_1" })
    ).rejects.toMatchObject({ code: "TRAINER_WIKI_UNSET" });
  });

  it("throws NO_ACTIVE_TRAINER when no trainer is configured", async () => {
    delete process.env.STADIUM_TRAINER;
    // No toml written — home has .vault/ but no stadium.toml

    const fetchMock = makeFetchMock({ match_id: "m_1", status: "drafting" });
    vi.stubGlobal("fetch", fetchMock);
    const { trainerAcceptMatchTool } = await import("../../src/tools/trainer-accept-match.js");

    await expect(
      trainerAcceptMatchTool.handler({ match_id: "m_1" })
    ).rejects.toMatchObject({ code: "NO_ACTIVE_TRAINER" });
  });
});

// ─── trainer-init ────────────────────────────────────────────────────────────

describe("trainer-init caller_trainer_id resolution", () => {
  let home: string;
  let vault: string;

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    ({ home, vault } = makeTempDirs());
    delete process.env.STADIUM_TRAINER;
    process.env.VAULT_PATH = vault;
    process.env.STADIUM_HOME = home;
    process.env.STADIUM_API_KEY = "sk_test";
    process.env.STADIUM_BASE_URL = "https://api.test";
    process.env.STADIUM_TRAINER_ID = "trn_test";
    mkdirSync(join(vault, "wikis", "_agents"), { recursive: true });
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(vault, { recursive: true, force: true });
    delete process.env.STADIUM_TRAINER;
    delete process.env.VAULT_PATH;
    delete process.env.STADIUM_HOME;
  });

  it("returns caller_trainer_id: null for first-time init (no trainer configured)", async () => {
    // No toml, no STADIUM_TRAINER env — this is the first init scenario
    delete process.env.STADIUM_TRAINER;
    // No toml written → resolveTrainerContext throws → caught → null

    const fetchMock = makeFetchMock({ status: "ok" });
    vi.stubGlobal("fetch", fetchMock);
    const { trainerInitTool } = await import("../../src/tools/trainer-init.js");

    const out = await trainerInitTool.handler(
      { name: "NewTrainer", strategy: "Lead Fire." },
      { vaultPath: vault }
    );

    expect(out).toHaveProperty("caller_trainer_id", null);
  });

  it("returns caller_trainer_id populated when an existing trainer is active", async () => {
    // Set up an existing trainer with full toml (including [trainer.*] section)
    writeWikisIndex(vault, ["_agents"]);
    writeTrainerPage(vault, "_agents", "existing-trainer", "01KQT3E0ABE70N8DMV6EQF1MA0", "_agents");
    // Must write toml with trainer section so resolveStadiumConfig doesn't throw
    writeTomlWithTrainer(home, "existing-trainer", "01KQT3E0ABE70N8DMV6EQF1MA0");

    const fetchMock = makeFetchMock({ status: "ok" });
    vi.stubGlobal("fetch", fetchMock);
    const { trainerInitTool } = await import("../../src/tools/trainer-init.js");

    const out = await trainerInitTool.handler(
      { name: "AnotherTrainer", strategy: "Balanced." },
      { vaultPath: vault }
    );

    expect(out).toHaveProperty("caller_trainer_id", "01KQT3E0ABE70N8DMV6EQF1MA0");
  });

  it("does not throw when no trainer is configured (graceful first-time init)", async () => {
    delete process.env.STADIUM_TRAINER;
    // No toml written

    const fetchMock = makeFetchMock({ status: "ok" });
    vi.stubGlobal("fetch", fetchMock);
    const { trainerInitTool } = await import("../../src/tools/trainer-init.js");

    // Should NOT throw even with no active trainer
    await expect(
      trainerInitTool.handler({ name: "NewTrainer" }, { vaultPath: vault })
    ).resolves.toBeDefined();
  });
});
