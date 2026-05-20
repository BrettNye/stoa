import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { syncMoveset, type SyncResult } from "../../src/core/skills.js";

/**
 * T10 of the specialist-agent-substrate DAG.
 *
 * Spec §4.3, §4.4: `syncMoveset` is the single point of truth for
 * deployment layering. After deploying the profile's portable moveset
 * (from `wikis/_agents/moves/`), it also deploys every wiki-local move
 * at `wikis/<input.wiki>/moves/<id>/SKILL.md`, with these rules:
 *
 *   - applies_to filtering applies uniformly to both layers.
 *   - On id collision (wiki-local shares an id with a portable move),
 *     portable wins; the wiki-local move is silently skipped from
 *     deployment (a lint rule, not this code path, surfaces it).
 *   - `moves_synced_portable` and `moves_synced_wiki_local` partition
 *     `moves_synced`.
 */
describe("integration — syncMoveset deployment layering (T10)", () => {
  let vaultPath: string;
  let repoPath: string;
  const WIKI = "crewtracks-modules";

  function seedProfileAndPortableMoves(): void {
    const profilesDir = join(vaultPath, "wikis", "_agents", "profiles");
    mkdirSync(profilesDir, { recursive: true });
    writeFileSync(join(profilesDir, "profile-charmander.md"),
      `---
id: profile-charmander
type: profile
title: Charmander
created: 2026-05-19
wiki: _agents
status: active
summary: x
pokemon_type: fire
evolution_stage: basic
moveset: [move-tdd-cycle, move-pr-create]
applies_to: [claude-code]
---

# Charmander
`);

    const tddDir = join(vaultPath, "wikis", "_agents", "moves", "move-tdd-cycle");
    mkdirSync(tddDir, { recursive: true });
    writeFileSync(join(tddDir, "SKILL.md"),
      `---
id: move-tdd-cycle
type: move
title: TDD cycle
created: 2026-05-19
name: tdd-cycle
description: x
applies_to: [claude-code, openclaw, codex]
---

# TDD
`);

    const prDir = join(vaultPath, "wikis", "_agents", "moves", "move-pr-create");
    mkdirSync(prDir, { recursive: true });
    writeFileSync(join(prDir, "SKILL.md"),
      `---
id: move-pr-create
type: move
title: Create PR
created: 2026-05-19
name: pr-create
description: x
applies_to: [claude-code]
---

# PR
`);
  }

  function seedWikiLocalMove(id: string, opts: { appliesTo?: string[] } = {}): void {
    const appliesTo = opts.appliesTo ?? ["claude-code", "openclaw", "codex"];
    const dir = join(vaultPath, "wikis", WIKI, "moves", id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"),
      `---
id: ${id}
type: move
title: ${id}
created: 2026-05-19
wiki: ${WIKI}
status: active
summary: x
name: ${id.replace(/^move-/, "")}
description: x
applies_to: [${appliesTo.join(", ")}]
scope_wiki: [${WIKI}]
---

# ${id}
`);
  }

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-int-t10-"));
    repoPath = mkdtempSync(join(tmpdir(), "repo-int-t10-"));
    seedProfileAndPortableMoves();
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    rmSync(repoPath, { recursive: true, force: true });
  });

  it("layers a wiki-local move onto the profile's portable moveset", () => {
    seedWikiLocalMove("move-add-crewtracks-module");

    const result: SyncResult = syncMoveset({
      vaultPath,
      repoPath,
      pokemon_id: "profile-charmander",
      target: "claude-code",
      mode: "copy",
      wiki: WIKI,
    });

    expect(result.moves_synced.sort()).toEqual([
      "move-add-crewtracks-module",
      "move-pr-create",
      "move-tdd-cycle",
    ]);
    expect(result.moves_synced_portable.sort()).toEqual([
      "move-pr-create",
      "move-tdd-cycle",
    ]);
    expect(result.moves_synced_wiki_local).toEqual([
      "move-add-crewtracks-module",
    ]);

    // Wiki-local SKILL.md should be physically present in the deployed skills dir.
    const deployed = join(
      repoPath, ".claude", "skills", "charmander",
      "move-add-crewtracks-module", "SKILL.md"
    );
    expect(existsSync(deployed)).toBe(true);
    expect(readFileSync(deployed, "utf8")).toContain("# move-add-crewtracks-module");
  });

  it("preserves existing fields on SyncResult (back-compat)", () => {
    seedWikiLocalMove("move-add-crewtracks-module");

    const result: SyncResult = syncMoveset({
      vaultPath,
      repoPath,
      pokemon_id: "profile-charmander",
      target: "claude-code",
      mode: "copy",
      wiki: WIKI,
    });

    expect(typeof result.skills_dir).toBe("string");
    expect(Array.isArray(result.moves_synced)).toBe(true);
    expect(Array.isArray(result.moves_skipped_unsupported)).toBe(true);
    expect(result.moves_synced.length).toBe(3);
    expect(result.moves_synced_portable.length).toBe(2);
    expect(result.moves_synced_wiki_local.length).toBe(1);
  });

  it("ID collision: portable wins; wiki-local is silently skipped from deployment", () => {
    // Wiki-local move shadows a portable id.
    seedWikiLocalMove("move-tdd-cycle");

    // Distinct content in the wiki-local SKILL.md so we can detect which version landed.
    const wikiLocalSkill = join(
      vaultPath, "wikis", WIKI, "moves", "move-tdd-cycle", "SKILL.md"
    );
    writeFileSync(wikiLocalSkill,
      `---
id: move-tdd-cycle
type: move
title: TDD cycle (CT specialization)
created: 2026-05-19
wiki: ${WIKI}
status: active
summary: x
name: tdd-cycle
description: x
applies_to: [claude-code, openclaw, codex]
scope_wiki: [${WIKI}]
---

# TDD CT-SPECIALIZED MARKER
`);

    const result: SyncResult = syncMoveset({
      vaultPath,
      repoPath,
      pokemon_id: "profile-charmander",
      target: "claude-code",
      mode: "copy",
      wiki: WIKI,
    });

    // moves_synced should contain move-tdd-cycle exactly once.
    const tddCount = result.moves_synced.filter(m => m === "move-tdd-cycle").length;
    expect(tddCount).toBe(1);

    // It must show up in portable, NOT wiki-local.
    expect(result.moves_synced_portable).toContain("move-tdd-cycle");
    expect(result.moves_synced_wiki_local).not.toContain("move-tdd-cycle");

    // Deployed content must be the portable one (not the CT-specialized marker).
    const deployed = readFileSync(
      join(repoPath, ".claude", "skills", "charmander", "move-tdd-cycle", "SKILL.md"),
      "utf8"
    );
    expect(deployed).toContain("# TDD");
    expect(deployed).not.toContain("CT-SPECIALIZED MARKER");
  });

  it("applies_to filtering applies to wiki-local moves too", () => {
    // openclaw-only wiki-local move; deploying to claude-code should skip it.
    seedWikiLocalMove("move-openclaw-only", { appliesTo: ["openclaw"] });
    seedWikiLocalMove("move-add-crewtracks-module"); // permissive, should land.

    const result: SyncResult = syncMoveset({
      vaultPath,
      repoPath,
      pokemon_id: "profile-charmander",
      target: "claude-code",
      mode: "copy",
      wiki: WIKI,
    });

    // The openclaw-only wiki-local move must NOT appear in synced.
    expect(result.moves_synced).not.toContain("move-openclaw-only");
    expect(result.moves_synced_wiki_local).toEqual(["move-add-crewtracks-module"]);

    // Portable layer is unaffected by the wiki-local applies_to filter.
    expect(result.moves_synced_portable.sort()).toEqual([
      "move-pr-create",
      "move-tdd-cycle",
    ]);
  });

  it("no wiki argument: behaves exactly like pre-T10 (portable layer only)", () => {
    seedWikiLocalMove("move-add-crewtracks-module");

    const result: SyncResult = syncMoveset({
      vaultPath,
      repoPath,
      pokemon_id: "profile-charmander",
      target: "claude-code",
      mode: "copy",
      // wiki omitted on purpose — back-compat with evolve-profile / sync-agents.
    });

    expect(result.moves_synced.sort()).toEqual(["move-pr-create", "move-tdd-cycle"]);
    expect(result.moves_synced_portable.sort()).toEqual(["move-pr-create", "move-tdd-cycle"]);
    expect(result.moves_synced_wiki_local).toEqual([]);
  });

  it("wiki=_agents: does NOT scan _agents/moves a second time as wiki-local", () => {
    // No new wiki-local seeds. If syncMoveset incorrectly treated _agents
    // as a wiki-local scan target, moves_synced_wiki_local would non-empty
    // (or moves_synced would contain duplicates).
    const result: SyncResult = syncMoveset({
      vaultPath,
      repoPath,
      pokemon_id: "profile-charmander",
      target: "claude-code",
      mode: "copy",
      wiki: "_agents",
    });

    expect(result.moves_synced.sort()).toEqual(["move-pr-create", "move-tdd-cycle"]);
    expect(result.moves_synced_wiki_local).toEqual([]);

    // No duplicates.
    const unique = new Set(result.moves_synced);
    expect(unique.size).toBe(result.moves_synced.length);
  });

  it("wiki has no moves/ folder: degrades gracefully, no error", () => {
    // No wikis/<WIKI>/moves/ ever created.
    const result: SyncResult = syncMoveset({
      vaultPath,
      repoPath,
      pokemon_id: "profile-charmander",
      target: "claude-code",
      mode: "copy",
      wiki: WIKI,
    });

    expect(result.moves_synced.sort()).toEqual(["move-pr-create", "move-tdd-cycle"]);
    expect(result.moves_synced_wiki_local).toEqual([]);
  });
});
