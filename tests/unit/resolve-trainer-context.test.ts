import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveTrainerContext, TrainerContextError } from "../../src/core/resolve-trainer-context.js";

/**
 * Test helper: creates a temp home dir (contains .vault/stadium.toml) and
 * a temp vault dir (contains wikis/_agents/trainers/trainer-<slug>.md).
 */
function makeTempDirs() {
  const home = mkdtempSync(join(tmpdir(), "vault-trainer-ctx-home-"));
  const vault = mkdtempSync(join(tmpdir(), "vault-trainer-ctx-vault-"));
  mkdirSync(join(home, ".vault"), { recursive: true });
  mkdirSync(join(vault, "wikis", "_agents", "trainers"), { recursive: true });
  mkdirSync(join(vault, "_index"), { recursive: true });
  return { home, vault };
}

function writeToml(home: string, content: string) {
  writeFileSync(join(home, ".vault", "stadium.toml"), content, "utf8");
}

function writeTrainerPage(
  vault: string,
  wiki: string,
  slug: string,
  frontmatter: Record<string, string>
) {
  mkdirSync(join(vault, "wikis", wiki, "trainers"), { recursive: true });
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");
  const content = `---\n${fm}\n---\n\nBody text.\n`;
  writeFileSync(
    join(vault, "wikis", wiki, "trainers", `trainer-${slug}.md`),
    content,
    "utf8"
  );
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

describe("resolveTrainerContext", () => {
  let home: string;
  let vault: string;

  beforeEach(() => {
    ({ home, vault } = makeTempDirs());
    delete process.env.STADIUM_TRAINER;
    // Clear module-level cache between tests by writing a new toml or varying mtime
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(vault, { recursive: true, force: true });
    delete process.env.STADIUM_TRAINER;
  });

  // ─── Error: NO_ACTIVE_TRAINER ─────────────────────────────────────────────

  it("errors NO_ACTIVE_TRAINER when nothing resolves", () => {
    // No toml, no env, no explicit arg
    expect(() => resolveTrainerContext({}, { home, vaultPath: vault })).toThrow(
      /NO_ACTIVE_TRAINER/
    );
  });

  it("NO_ACTIVE_TRAINER message lists all three resolution paths", () => {
    let thrown: unknown;
    try {
      resolveTrainerContext({}, { home, vaultPath: vault });
      expect.fail("should have thrown TrainerContextError");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(TrainerContextError);
    const err = thrown as TrainerContextError;
    expect(err.code).toBe("NO_ACTIVE_TRAINER");
    expect(err.message).toMatch(/trainer:/);
    expect(err.message).toMatch(/STADIUM_TRAINER/);
    expect(err.message).toMatch(/active/);
  });

  // ─── Trainer resolution priority ─────────────────────────────────────────

  it("explicit trainer: arg wins over STADIUM_TRAINER env and toml active", () => {
    writeToml(home, `active = "toml-slug"\n\n[trainer.explicit-slug]\ntrainer_id = "01AAAAAAAAAAAAAAAAAAAAAAAAA"\n\n[trainer.toml-slug]\ntrainer_id = "01BBBBBBBBBBBBBBBBBBBBBBBBB"\n`);
    writeWikisIndex(vault, ["_agents"]);
    writeTrainerPage(vault, "_agents", "explicit-slug", {
      id: "trainer-explicit-slug",
      type: "trainer",
      title: "Explicit Slug",
      trainer_id: "01AAAAAAAAAAAAAAAAAAAAAAAAA",
      trainer_slug: "explicit-slug",
      wiki: "_agents",
      status: "active",
      created: "2026-05-04",
    });
    process.env.STADIUM_TRAINER = "toml-slug";
    const ctx = resolveTrainerContext(
      { trainer: "explicit-slug" },
      { home, vaultPath: vault }
    );
    expect(ctx.trainerSlug).toBe("explicit-slug");
  });

  it("STADIUM_TRAINER env wins over toml active when no explicit arg", () => {
    writeToml(home, `active = "toml-slug"\n\n[trainer.env-slug]\ntrainer_id = "01CCCCCCCCCCCCCCCCCCCCCCCCC"\n\n[trainer.toml-slug]\ntrainer_id = "01DDDDDDDDDDDDDDDDDDDDDDDDD"\n`);
    writeWikisIndex(vault, ["_agents"]);
    writeTrainerPage(vault, "_agents", "env-slug", {
      id: "trainer-env-slug",
      type: "trainer",
      title: "Env Slug",
      trainer_id: "01CCCCCCCCCCCCCCCCCCCCCCCCC",
      trainer_slug: "env-slug",
      wiki: "_agents",
      status: "active",
      created: "2026-05-04",
    });
    process.env.STADIUM_TRAINER = "env-slug";
    const ctx = resolveTrainerContext({}, { home, vaultPath: vault });
    expect(ctx.trainerSlug).toBe("env-slug");
  });

  it("toml active resolves when no explicit arg or env", () => {
    writeToml(home, `active = "toml-slug"\n\n[trainer.toml-slug]\ntrainer_id = "01EEEEEEEEEEEEEEEEEEEEEEEEE"\n`);
    writeWikisIndex(vault, ["_agents"]);
    writeTrainerPage(vault, "_agents", "toml-slug", {
      id: "trainer-toml-slug",
      type: "trainer",
      title: "Toml Slug",
      trainer_id: "01EEEEEEEEEEEEEEEEEEEEEEEEE",
      trainer_slug: "toml-slug",
      wiki: "_agents",
      status: "active",
      created: "2026-05-04",
    });
    const ctx = resolveTrainerContext({}, { home, vaultPath: vault });
    expect(ctx.trainerSlug).toBe("toml-slug");
  });

  // ─── Error: TRAINER_NOT_FOUND ─────────────────────────────────────────────

  it("errors TRAINER_NOT_FOUND when slug resolves but no trainer file exists", () => {
    writeToml(home, `active = "ghost-slug"\n`);
    writeWikisIndex(vault, ["_agents"]);
    // No trainer file written
    let thrown: unknown;
    try {
      resolveTrainerContext({}, { home, vaultPath: vault });
      expect.fail("should have thrown TrainerContextError");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(TrainerContextError);
    expect((thrown as TrainerContextError).code).toBe("TRAINER_NOT_FOUND");
  });

  it("TRAINER_NOT_FOUND searches across multiple wikis", () => {
    writeToml(home, `active = "missing-slug"\n`);
    // Two wikis indexed but neither has the trainer file
    writeWikisIndex(vault, ["_agents", "my-project"]);
    mkdirSync(join(vault, "wikis", "my-project", "trainers"), { recursive: true });
    expect(() => resolveTrainerContext({}, { home, vaultPath: vault })).toThrow(
      /TRAINER_NOT_FOUND/
    );
  });

  // ─── Error: TRAINER_WIKI_UNSET ────────────────────────────────────────────

  it("errors TRAINER_WIKI_UNSET when trainer file has no wiki field", () => {
    writeToml(home, `active = "no-wiki"\n`);
    writeWikisIndex(vault, ["_agents"]);
    // Trainer file missing wiki: field
    const fm = [
      `id: "trainer-no-wiki"`,
      `type: "trainer"`,
      `title: "No Wiki"`,
      `trainer_id: "01FFFFFFFFFFFFFFFFFFFFFFFFFFF"`,
      `trainer_slug: "no-wiki"`,
      `status: "active"`,
      `created: "2026-05-04"`,
    ].join("\n");
    writeFileSync(
      join(vault, "wikis", "_agents", "trainers", "trainer-no-wiki.md"),
      `---\n${fm}\n---\n\nBody.\n`,
      "utf8"
    );
    let thrown: unknown;
    try {
      resolveTrainerContext({}, { home, vaultPath: vault });
      expect.fail("should have thrown TrainerContextError");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(TrainerContextError);
    expect((thrown as TrainerContextError).code).toBe("TRAINER_WIKI_UNSET");
  });

  // ─── Happy path: returns correct tuple ───────────────────────────────────

  it("returns {trainerSlug, trainerId, wiki} on success", () => {
    writeToml(home, `active = "brett-trainer1"\n\n[trainer.brett-trainer1]\ntrainer_id = "01KQT3E0ABE70N8DMV6EQF1MA0"\n`);
    writeWikisIndex(vault, ["_agents"]);
    writeTrainerPage(vault, "_agents", "brett-trainer1", {
      id: "trainer-brett-trainer1",
      type: "trainer",
      title: "Brett-trainer1",
      trainer_id: "01KQT3E0ABE70N8DMV6EQF1MA0",
      trainer_slug: "brett-trainer1",
      wiki: "_agents",
      status: "active",
      created: "2026-05-04",
    });
    const ctx = resolveTrainerContext({}, { home, vaultPath: vault });
    expect(ctx).toEqual({
      trainerSlug: "brett-trainer1",
      trainerId: "01KQT3E0ABE70N8DMV6EQF1MA0",
      wiki: "_agents",
    });
  });

  it("finds trainer file in a non-_agents wiki", () => {
    writeToml(home, `active = "alpha-trainer"\n`);
    writeWikisIndex(vault, ["_agents", "alpha"]);
    mkdirSync(join(vault, "wikis", "alpha", "trainers"), { recursive: true });
    writeTrainerPage(vault, "alpha", "alpha-trainer", {
      id: "trainer-alpha-trainer",
      type: "trainer",
      title: "Alpha Trainer",
      trainer_id: "01GGGGGGGGGGGGGGGGGGGGGGGG1",
      trainer_slug: "alpha-trainer",
      wiki: "alpha",
      status: "active",
      created: "2026-05-04",
    });
    const ctx = resolveTrainerContext({}, { home, vaultPath: vault });
    expect(ctx.trainerSlug).toBe("alpha-trainer");
    expect(ctx.wiki).toBe("alpha");
  });

  // ─── Cache invalidation ───────────────────────────────────────────────────

  it("mtime-based cache invalidates when toml file changes", () => {
    writeToml(home, `active = "slug-a"\n`);
    writeWikisIndex(vault, ["_agents"]);
    writeTrainerPage(vault, "_agents", "slug-a", {
      id: "trainer-slug-a",
      type: "trainer",
      title: "Slug A",
      trainer_id: "01HHHHHHHHHHHHHHHHHHHHHHHHH",
      trainer_slug: "slug-a",
      wiki: "_agents",
      status: "active",
      created: "2026-05-04",
    });
    // First call — resolves slug-a
    const ctx1 = resolveTrainerContext({}, { home, vaultPath: vault });
    expect(ctx1.trainerSlug).toBe("slug-a");

    // Write slug-b page, update toml to change active
    writeTrainerPage(vault, "_agents", "slug-b", {
      id: "trainer-slug-b",
      type: "trainer",
      title: "Slug B",
      trainer_id: "01IIIIIIIIIIIIIIIIIIIIIIIII",
      trainer_slug: "slug-b",
      wiki: "_agents",
      status: "active",
      created: "2026-05-04",
    });
    // Advance mtime by writing new toml content (mtime will differ)
    writeToml(home, `active = "slug-b"\n`);

    // Second call — cache should have been invalidated by new mtime
    const ctx2 = resolveTrainerContext({}, { home, vaultPath: vault });
    expect(ctx2.trainerSlug).toBe("slug-b");
  });
});
