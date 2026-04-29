import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startTool } from "../../src/tools/start.js";

describe("vault.start", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-start-"));
    mkdirSync(join(vaultPath, "wikis", "alpha"), { recursive: true });
    mkdirSync(join(vaultPath, "wikis", "alpha", "concepts"), { recursive: true });
    writeFileSync(join(vaultPath, "wikis", "alpha", "map.md"),
      `---
id: map-alpha
type: map
title: alpha
created: 2026-04-29
wiki: alpha
status: active
summary: alpha map
updated: 2026-04-29
---

# alpha map

Hand-curated entry point.
`);
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    writeFileSync(join(vaultPath, "_index", "pages.json"), JSON.stringify({}));
    writeFileSync(join(vaultPath, "_index", "aliases.json"), "{}");
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("returns a context brief with map_summary and channel_activity", async () => {
    const r = await startTool.handler({ wiki: "alpha" }, { vaultPath });
    expect(r.map_summary).toContain("alpha map");
    expect(Array.isArray(r.active_pages_summary)).toBe(true);
    expect(Array.isArray(r.channel_activity)).toBe(true);
    expect(r.pokemon_state).toBeUndefined();
  });

  it("includes pokemon_state when pokemon is set", async () => {
    const profilesDir = join(vaultPath, "wikis", "_agents", "profiles");
    mkdirSync(profilesDir, { recursive: true });
    writeFileSync(join(profilesDir, "profile-charmander.md"),
      `---
id: profile-charmander
type: profile
title: Charmander
created: 2026-04-29
wiki: _agents
status: active
summary: x
pokemon_type: fire
evolution_stage: basic
moveset: []
---

# Charmander
`);
    const r = await startTool.handler(
      { wiki: "alpha", pokemon: "profile-charmander" },
      { vaultPath }
    );
    expect(r.pokemon_state).toBeDefined();
    expect(r.pokemon_state?.name).toBe("charmander");
    expect(r.pokemon_state?.evolution_stage).toBe("basic");
  });
});
