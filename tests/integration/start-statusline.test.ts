import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { startTool } from "../../src/tools/start.js";

// Phase-3 T4-1 — `tools/start` writes `_index/statusline.json` containing
// the active Pokemon's name, type, and a pre-resolved `type_label`. The
// `type_label` is the type emoji by default, or a text fallback like
// `[psychic]` when `display_config.statusline.emoji_safe_mode: true`.

function scaffoldVault(): string {
  const vaultPath = mkdtempSync(join(tmpdir(), "vault-int-statusline-"));
  mkdirSync(join(vaultPath, "wikis", "alpha"), { recursive: true });
  mkdirSync(join(vaultPath, "wikis", "_agents", "profiles"), { recursive: true });
  mkdirSync(join(vaultPath, "_index"), { recursive: true });
  writeFileSync(join(vaultPath, "_index", "aliases.json"), "{}");
  writeFileSync(join(vaultPath, "wikis", "alpha", "map.md"),
    `---
id: map-alpha
type: map
title: alpha
created: 2026-04-29
wiki: alpha
status: active
summary: x
updated: 2026-04-29
---

# alpha map
`);
  return vaultPath;
}

function writeProfile(vaultPath: string, name: string, pokemonType: string): void {
  writeFileSync(
    join(vaultPath, "wikis", "_agents", "profiles", `profile-${name}.md`),
    [
      "---",
      `id: profile-${name}`,
      "type: profile",
      `title: ${name}`,
      "created: 2026-04-30",
      "wiki: _agents",
      "status: active",
      "summary: test",
      `pokemon_type: ${pokemonType}`,
      "evolution_stage: stage2",
      "moveset: []",
      "---",
      "",
      `# ${name}`,
      ""
    ].join("\n")
  );
}

function writeDisplayConfig(vaultPath: string, body: string): void {
  // Append a display_config fence to wikis/_agents/CLAUDE.md (creating the
  // file if absent).
  const path = join(vaultPath, "wikis", "_agents", "CLAUDE.md");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "# _agents\n\n";
  writeFileSync(path, existing + "\n```yaml display_config\n" + body + "\n```\n");
}

describe("integration — /start writes statusline JSON (T4-1)", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = scaffoldVault();
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("writes _index/statusline.json with the type emoji by default", async () => {
    writeProfile(vaultPath, "mewtwo", "psychic");
    await startTool.handler(
      { wiki: "alpha", pokemon: "mewtwo" },
      { vaultPath }
    );

    const path = join(vaultPath, "_index", "statusline.json");
    expect(existsSync(path)).toBe(true);
    const data = JSON.parse(readFileSync(path, "utf8"));
    expect(data.name).toBe("mewtwo");
    expect(data.pokemon_type).toBe("psychic");
    // Default mode → emoji glyph.
    expect(data.type_label).toBe("🔮");
  });

  it("writes a text-fallback type_label when emoji_safe_mode is true", async () => {
    writeProfile(vaultPath, "mewtwo", "psychic");
    writeDisplayConfig(vaultPath, "statusline:\n  emoji_safe_mode: true");

    await startTool.handler(
      { wiki: "alpha", pokemon: "mewtwo" },
      { vaultPath }
    );

    const path = join(vaultPath, "_index", "statusline.json");
    expect(existsSync(path)).toBe(true);
    const data = JSON.parse(readFileSync(path, "utf8"));
    expect(data.type_label).toBe("[psychic]");
    expect(data.pokemon_type).toBe("psychic");
  });

  it("uses the fire emoji 🔥 by default for a fire-type profile", async () => {
    writeProfile(vaultPath, "charmander", "fire");
    await startTool.handler(
      { wiki: "alpha", pokemon: "charmander" },
      { vaultPath }
    );

    const data = JSON.parse(readFileSync(join(vaultPath, "_index", "statusline.json"), "utf8"));
    expect(data.type_label).toBe("🔥");
  });

  it("uses the [fire] text fallback for a fire-type profile in emoji_safe_mode", async () => {
    writeProfile(vaultPath, "charmander", "fire");
    writeDisplayConfig(vaultPath, "statusline:\n  emoji_safe_mode: true");
    await startTool.handler(
      { wiki: "alpha", pokemon: "charmander" },
      { vaultPath }
    );

    const data = JSON.parse(readFileSync(join(vaultPath, "_index", "statusline.json"), "utf8"));
    expect(data.type_label).toBe("[fire]");
  });

  it("only flips emoji_safe_mode without affecting sprite color mode", async () => {
    // emoji_safe_mode: true; sprites: untouched. The display config reader
    // should leave sprites.color_mode at its default ("truecolor").
    writeProfile(vaultPath, "mewtwo", "psychic");
    writeDisplayConfig(vaultPath, "statusline:\n  emoji_safe_mode: true");

    // Just verifying the statusline write picks up emoji_safe_mode and the
    // call doesn't throw — sprite path validation lives in start-sprites.test.ts.
    await startTool.handler(
      { wiki: "alpha", pokemon: "mewtwo" },
      { vaultPath }
    );
    const data = JSON.parse(readFileSync(join(vaultPath, "_index", "statusline.json"), "utf8"));
    expect(data.type_label).toBe("[psychic]");
  });

  it("does not write statusline.json when no pokemon argument is provided", async () => {
    // /start without a pokemon → nothing to populate the statusline with;
    // we should not produce a stale/empty file.
    await startTool.handler(
      { wiki: "alpha" },
      { vaultPath }
    );
    expect(existsSync(join(vaultPath, "_index", "statusline.json"))).toBe(false);
  });
});
