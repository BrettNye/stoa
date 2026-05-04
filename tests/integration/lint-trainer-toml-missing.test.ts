import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lintTool } from "../../src/tools/lint.js";

let vault: string;
let fakeHome: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-lint-ttm-"));
  fakeHome = mkdtempSync(join(tmpdir(), "fake-home-ttm-"));

  // Minimal vault skeleton
  mkdirSync(join(vault, "_index"), { recursive: true });
  mkdirSync(join(vault, "wikis", "_agents", "trainers"), { recursive: true });
  writeFileSync(join(vault, "wikis", "_agents", "map.md"),
    `---
id: map-_agents
title: agents
type: map
wiki: _agents
status: active
created: 2026-04-30
updated: 2026-04-30
summary: m
---
`);
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
  rmSync(fakeHome, { recursive: true, force: true });
  delete process.env.STADIUM_HOME;
});

function writeToml(slugs: Array<{ slug: string; trainer_id: string }>) {
  mkdirSync(join(fakeHome, ".vault"), { recursive: true });
  const lines: string[] = [];
  for (const { slug, trainer_id } of slugs) {
    lines.push(`[trainer.${slug}]`);
    lines.push(`trainer_id = "${trainer_id}"`);
    lines.push(`api_key = "test_key"`);
    lines.push(`base_url = "http://localhost:3000"`);
    lines.push("");
  }
  writeFileSync(join(fakeHome, ".vault", "stadium.toml"), lines.join("\n"), "utf8");
  process.env.STADIUM_HOME = fakeHome;
}

function writeTrainerFile(vault: string, slug: string, trainer_id: string) {
  const trainersDir = join(vault, "wikis", "_agents", "trainers");
  mkdirSync(trainersDir, { recursive: true });
  writeFileSync(join(trainersDir, `trainer-${slug}.md`),
    `---
id: trainer-${slug}
type: trainer
title: "Trainer ${slug}"
trainer_id: ${trainer_id}
trainer_slug: ${slug}
wiki: _agents
status: active
created: 2026-05-04
---
`);
}

async function runLint(wiki?: string) {
  return await lintTool.handler(
    { level: "error" as const, ...(wiki ? { wiki } : {}) },
    { vaultPath: vault }
  );
}

describe("TRAINER_TOML_MISSING", () => {
  it("flags error when trainer-<slug>.md exists but no matching toml block", async () => {
    process.env.STADIUM_HOME = fakeHome;
    // No toml file — empty .vault dir
    mkdirSync(join(fakeHome, ".vault"), { recursive: true });
    writeTrainerFile(vault, "trainer1", "01KQT3E0ABE70N8DMV6EQF1MA0");
    const r = await runLint("_agents");
    const d = r.diagnostics.find(x => x.code === "TRAINER_TOML_MISSING");
    expect(d).toBeDefined();
    expect(d?.severity).toBe("error");
    expect(d?.wiki).toBe("_agents");
  });

  it("message includes the orphaned slug", async () => {
    process.env.STADIUM_HOME = fakeHome;
    mkdirSync(join(fakeHome, ".vault"), { recursive: true });
    writeTrainerFile(vault, "trainer1", "01KQT3E0ABE70N8DMV6EQF1MA0");
    const r = await runLint("_agents");
    const d = r.diagnostics.find(x => x.code === "TRAINER_TOML_MISSING");
    expect(d?.message).toMatch(/trainer1/);
  });

  it("does not flag when the toml block exists for the file", async () => {
    writeToml([{ slug: "trainer1", trainer_id: "01KQT3E0ABE70N8DMV6EQF1MA0" }]);
    writeTrainerFile(vault, "trainer1", "01KQT3E0ABE70N8DMV6EQF1MA0");
    const r = await runLint("_agents");
    expect(r.diagnostics.some(d => d.code === "TRAINER_TOML_MISSING")).toBe(false);
  });

  it("does not flag when the trainers directory is empty", async () => {
    writeToml([]);
    // Empty trainers dir exists from beforeEach, no files
    const r = await runLint("_agents");
    expect(r.diagnostics.some(d => d.code === "TRAINER_TOML_MISSING")).toBe(false);
  });

  it("does not fire when linting a different wiki", async () => {
    process.env.STADIUM_HOME = fakeHome;
    mkdirSync(join(fakeHome, ".vault"), { recursive: true });
    writeTrainerFile(vault, "trainer1", "01KQT3E0ABE70N8DMV6EQF1MA0");
    const r = await runLint("some-other-wiki");
    expect(r.diagnostics.some(d => d.code === "TRAINER_TOML_MISSING")).toBe(false);
  });

  it("flags multiple orphaned trainer files when multiple files have no toml entry", async () => {
    process.env.STADIUM_HOME = fakeHome;
    mkdirSync(join(fakeHome, ".vault"), { recursive: true });
    writeTrainerFile(vault, "trainer1", "01KQT3E0ABE70N8DMV6EQF1MA0");
    writeTrainerFile(vault, "trainer2", "01KQT3F6PM73GM35ANJGVWWCT5");
    const r = await runLint("_agents");
    const findings = r.diagnostics.filter(d => d.code === "TRAINER_TOML_MISSING");
    expect(findings.length).toBe(2);
  });

  it("does not flag a file that is not named trainer-<slug>.md pattern", async () => {
    process.env.STADIUM_HOME = fakeHome;
    mkdirSync(join(fakeHome, ".vault"), { recursive: true });
    // Write a non-trainer file in the trainers dir
    writeFileSync(
      join(vault, "wikis", "_agents", "trainers", "readme.md"),
      "# Notes\n"
    );
    const r = await runLint("_agents");
    expect(r.diagnostics.some(d => d.code === "TRAINER_TOML_MISSING")).toBe(false);
  });
});
