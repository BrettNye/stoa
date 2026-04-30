import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startTool } from "../../src/tools/start.js";
import { reindex } from "../../src/core/reindex.js";

/**
 * Phase-2 T3-4 — `vault.start --family=<name>` assembles a multi-member brief.
 *
 * Each family member's `map.md` is read end-to-end and concatenated under a
 * per-member section header `## <member-name> (mode: <mode>)`. Profile state
 * (`--pokemon`) is unchanged — single profile, family doesn't fork it.
 * Channels declared on the profile auto-tail once each, regardless of member.
 */

interface FamilyMemberFixture {
  name: string;
  mode: "project-doc" | "coordination" | "idea-map" | "learning" | "mixed";
  family: string;
  mapBody: string;
}

function writeFamilyMember(vaultPath: string, m: FamilyMemberFixture): void {
  mkdirSync(join(vaultPath, "wikis", m.name), { recursive: true });
  writeFileSync(
    join(vaultPath, "wikis", m.name, "CLAUDE.md"),
    `# ${m.name} — wiki conventions\n\n**Mode:** ${m.mode}\n**Family:** ${m.family}\n**Scope:** test fixture\n`
  );
  writeFileSync(
    join(vaultPath, "wikis", m.name, "map.md"),
    `---
id: map-${m.name}
type: map
title: ${m.name}
created: 2026-04-30
wiki: ${m.name}
status: active
summary: ${m.name} fixture
updated: 2026-04-30
---

# ${m.name} map

${m.mapBody}
`
  );
}

function writeProfile(vaultPath: string, channelsTailed: string[] = []): void {
  mkdirSync(join(vaultPath, "wikis", "_agents", "profiles"), { recursive: true });
  const inline = channelsTailed.map(c => `"${c}"`).join(", ");
  writeFileSync(
    join(vaultPath, "wikis", "_agents", "profiles", "profile-charmander.md"),
    `---
id: profile-charmander
type: profile
title: Charmander
created: 2026-04-29
wiki: _agents
status: active
summary: Backend
pokemon_type: fire
evolution_stage: basic
moveset: []
channels_tailed: [${inline}]
---

# Charmander
`
  );
}

describe("integration — start with family: filter", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-int-start-family-"));
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    writeFileSync(join(vaultPath, "_index", "aliases.json"), "{}");
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("--family aggregates each member's map.md sectioned by member with mode header", async () => {
    writeFamilyMember(vaultPath, {
      name: "rastate-core", mode: "project-doc", family: "rastate",
      mapBody: "rastate-core CONTENT — durable knowledge entry"
    });
    writeFamilyMember(vaultPath, {
      name: "rastate-dev", mode: "coordination", family: "rastate",
      mapBody: "rastate-dev CONTENT — task + journal coordination"
    });
    writeFamilyMember(vaultPath, {
      name: "rastate-ideas", mode: "idea-map", family: "rastate",
      mapBody: "rastate-ideas CONTENT — exploratory questions"
    });
    writeFamilyMember(vaultPath, {
      name: "rastate-learning", mode: "learning", family: "rastate",
      mapBody: "rastate-learning CONTENT — distilled sources"
    });
    // Sibling unrelated wiki to confirm filter exclusion.
    writeFamilyMember(vaultPath, {
      name: "_meta", mode: "mixed", family: "",
      mapBody: "_meta CONTENT — should NOT appear"
    });
    reindex(vaultPath);

    const r = await startTool.handler({ family: "rastate" }, { vaultPath });

    // Section headers — alphabetic order: core, dev, ideas, learning.
    expect(r.map_summary).toContain("## rastate-core (mode: project-doc)");
    expect(r.map_summary).toContain("## rastate-dev (mode: coordination)");
    expect(r.map_summary).toContain("## rastate-ideas (mode: idea-map)");
    expect(r.map_summary).toContain("## rastate-learning (mode: learning)");

    // Full map content per member.
    expect(r.map_summary).toContain("rastate-core CONTENT");
    expect(r.map_summary).toContain("rastate-dev CONTENT");
    expect(r.map_summary).toContain("rastate-ideas CONTENT");
    expect(r.map_summary).toContain("rastate-learning CONTENT");

    // Sibling wiki excluded.
    expect(r.map_summary).not.toContain("_meta CONTENT");

    // Section ordering — alphabetic by member name.
    const coreIdx = r.map_summary.indexOf("## rastate-core");
    const devIdx = r.map_summary.indexOf("## rastate-dev");
    const ideasIdx = r.map_summary.indexOf("## rastate-ideas");
    const learningIdx = r.map_summary.indexOf("## rastate-learning");
    expect(coreIdx).toBeGreaterThanOrEqual(0);
    expect(coreIdx).toBeLessThan(devIdx);
    expect(devIdx).toBeLessThan(ideasIdx);
    expect(ideasIdx).toBeLessThan(learningIdx);
  });

  it("--family with --pokemon does not fork profile state and tails declared channels once", async () => {
    writeFamilyMember(vaultPath, {
      name: "rastate-core", mode: "project-doc", family: "rastate",
      mapBody: "core content"
    });
    writeFamilyMember(vaultPath, {
      name: "rastate-dev", mode: "coordination", family: "rastate",
      mapBody: "dev content"
    });
    writeProfile(vaultPath, ["rastate-coord"]);
    reindex(vaultPath);

    const r = await startTool.handler(
      { family: "rastate", pokemon: "charmander" },
      { vaultPath }
    );

    expect(r.pokemon_state).toBeDefined();
    expect(r.pokemon_state?.name).toBe("charmander");
    // Single profile, not forked across members.
    expect(r.pokemon_state?.pokemon_type).toBe("fire");

    // Channel auto-tailed once even though family has multiple members.
    const coord = r.channel_activity.filter(c => c.channel === "rastate-coord");
    expect(coord).toHaveLength(1);
  });

  it("--wiki=<member> behaviour unchanged from v1.5 (no family aggregation)", async () => {
    writeFamilyMember(vaultPath, {
      name: "rastate-core", mode: "project-doc", family: "rastate",
      mapBody: "rastate-core MAP — durable"
    });
    writeFamilyMember(vaultPath, {
      name: "rastate-dev", mode: "coordination", family: "rastate",
      mapBody: "rastate-dev MAP — coordination"
    });
    reindex(vaultPath);

    const r = await startTool.handler({ wiki: "rastate-core" }, { vaultPath });

    // Single-wiki summary contains rastate-core's map; no family section
    // headers; sibling member's content not pulled in.
    expect(r.map_summary).toContain("rastate-core MAP");
    expect(r.map_summary).not.toContain("rastate-dev MAP");
    expect(r.map_summary).not.toContain("## rastate-core (mode:");
  });
});
