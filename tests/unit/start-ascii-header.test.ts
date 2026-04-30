import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadAsciiHeader } from "../../src/core/start.js";

describe("loadAsciiHeader", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-ah-"));
    mkdirSync(join(vaultPath, "_index", "sprites"), { recursive: true });
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("returns a 3-line header when the sprite file exists", () => {
    writeFileSync(join(vaultPath, "_index", "sprites", "charmander.txt"),
      `  /\\_/\\\n ( o.o )\n  /tail`);
    const r = loadAsciiHeader(vaultPath, {
      name: "charmander",
      pokemon_type: "fire",
      evolution_stage: "basic",
      active_tasks: []
    }, { unread_total: 0 });
    expect(r).toBeDefined();
    const lines = r!.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines[0]).toContain("/\\_/\\");
    expect(r).toMatch(/Charmander|charmander/i);
    expect(r).toMatch(/basic/);
    expect(r).toMatch(/fire/);
  });

  it("returns undefined when the sprite file does not exist", () => {
    const r = loadAsciiHeader(vaultPath, {
      name: "missingmon",
      pokemon_type: "normal",
      evolution_stage: "basic",
      active_tasks: []
    }, { unread_total: 0 });
    expect(r).toBeUndefined();
  });

  it("includes task and unread counts in the summary line", () => {
    writeFileSync(join(vaultPath, "_index", "sprites", "charmander.txt"),
      `  /\\_/\\\n ( o.o )\n  /tail`);
    const r = loadAsciiHeader(vaultPath, {
      name: "charmander",
      pokemon_type: "fire",
      evolution_stage: "basic",
      active_tasks: [{ id: "task-x", title: "x", status: "in_progress" }]
    }, { unread_total: 2 });
    expect(r).toMatch(/1 task/);
    expect(r).toMatch(/2 unread/);
  });
});
