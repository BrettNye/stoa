import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lintTool } from "../../src/tools/lint.js";

let vault: string;
let fakeHome: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-lint-tim-"));
  fakeHome = mkdtempSync(join(tmpdir(), "fake-home-tim-"));

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

describe("TRAINER_ID_MISMATCH", () => {
  it("flags error when toml ULID differs from file frontmatter ULID", async () => {
    const tomlId = "01KQT3E0ABE70N8DMV6EQF1MA0";
    const fileId = "01KQT3F6PM73GM35ANJGVWWCT5"; // different ULID
    writeToml([{ slug: "trainer1", trainer_id: tomlId }]);
    writeTrainerFile(vault, "trainer1", fileId);
    const r = await runLint("_agents");
    const d = r.diagnostics.find(x => x.code === "TRAINER_ID_MISMATCH");
    expect(d).toBeDefined();
    expect(d?.severity).toBe("error");
    expect(d?.wiki).toBe("_agents");
  });

  it("message includes both ULIDs", async () => {
    const tomlId = "01KQT3E0ABE70N8DMV6EQF1MA0";
    const fileId = "01KQT3F6PM73GM35ANJGVWWCT5";
    writeToml([{ slug: "trainer1", trainer_id: tomlId }]);
    writeTrainerFile(vault, "trainer1", fileId);
    const r = await runLint("_agents");
    const d = r.diagnostics.find(x => x.code === "TRAINER_ID_MISMATCH");
    expect(d?.message).toMatch(new RegExp(tomlId));
    expect(d?.message).toMatch(new RegExp(fileId));
  });

  it("does not flag when toml and file trainer_id match", async () => {
    const sharedId = "01KQT3E0ABE70N8DMV6EQF1MA0";
    writeToml([{ slug: "trainer1", trainer_id: sharedId }]);
    writeTrainerFile(vault, "trainer1", sharedId);
    const r = await runLint("_agents");
    expect(r.diagnostics.some(d => d.code === "TRAINER_ID_MISMATCH")).toBe(false);
  });

  it("does not flag when the trainer file is missing (covered by TRAINER_FILE_MISSING)", async () => {
    writeToml([{ slug: "trainer1", trainer_id: "01KQT3E0ABE70N8DMV6EQF1MA0" }]);
    // No file written — TRAINER_FILE_MISSING should fire, not TRAINER_ID_MISMATCH
    const r = await runLint("_agents");
    expect(r.diagnostics.some(d => d.code === "TRAINER_ID_MISMATCH")).toBe(false);
  });

  it("does not fire when linting a different wiki", async () => {
    const tomlId = "01KQT3E0ABE70N8DMV6EQF1MA0";
    const fileId = "01KQT3F6PM73GM35ANJGVWWCT5";
    writeToml([{ slug: "trainer1", trainer_id: tomlId }]);
    writeTrainerFile(vault, "trainer1", fileId);
    const r = await runLint("some-other-wiki");
    expect(r.diagnostics.some(d => d.code === "TRAINER_ID_MISMATCH")).toBe(false);
  });

  it("flags only the mismatched entry when multiple trainers are present", async () => {
    const id1 = "01KQT3E0ABE70N8DMV6EQF1MA0";
    const id2 = "01KQT3F6PM73GM35ANJGVWWCT5";
    const id2Wrong = "01KQTZZZZZZZZZZZZZZZZZZZZZ";
    writeToml([
      { slug: "trainer1", trainer_id: id1 },
      { slug: "trainer2", trainer_id: id2 },
    ]);
    writeTrainerFile(vault, "trainer1", id1);      // match
    writeTrainerFile(vault, "trainer2", id2Wrong); // mismatch
    const r = await runLint("_agents");
    const findings = r.diagnostics.filter(d => d.code === "TRAINER_ID_MISMATCH");
    expect(findings.length).toBe(1);
    expect(findings[0].message).toMatch(/trainer2/);
  });
});
