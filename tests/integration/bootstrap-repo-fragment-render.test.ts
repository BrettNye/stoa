// vault-mcp/tests/integration/bootstrap-repo-fragment-render.test.ts
//
// T11 of specialist-agent-substrate DAG — verifies the CLAUDE.md bootstrap
// fragment renders portable and wiki-local movesets in two visually-
// separated subsections per spec §4.3:
//
//   ## Moveset
//
//   ### Portable moves
//   - move-tdd-cycle — Red-green-refactor with test-first discipline
//
//   ### Specialist moves (<wiki>)
//   - move-add-crewtracks-module — ...
//
// Edge cases:
//   - Empty `moves_synced_wiki_local` → OMIT `### Specialist moves` subsection.
//   - Empty `moves_synced_portable` → OMIT `### Portable moves` subsection.
//   - `<wiki>` in the specialist heading is the actual `--wiki` argument.
//   - Each bullet line is `- <move-id> — <move-summary-from-frontmatter>`.
//
// T10 already populates `moves_synced_portable` + `moves_synced_wiki_local`
// on SyncResult; this task is rendering only. Hermetic temp vault/repo per
// the existing bootstrap-repo.test.ts pattern.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bootstrapRepoTool } from "../../src/tools/bootstrap-repo.js";

/** Seed a profile page in wikis/_agents/profiles. */
function seedProfile(vaultPath: string, profileId: string, moveset: string[]): void {
  const profilesDir = join(vaultPath, "wikis", "_agents", "profiles");
  mkdirSync(profilesDir, { recursive: true });
  const movesetYaml = JSON.stringify(moveset);
  writeFileSync(
    join(profilesDir, `${profileId}.md`),
    `---
id: ${profileId}
type: profile
title: ${profileId}
created: 2026-05-19
wiki: _agents
status: active
summary: test profile
pokemon_type: fire
evolution_stage: basic
moveset: ${movesetYaml}
applies_to: [claude-code]
---

# ${profileId}
`,
    "utf8",
  );
}

/** Seed a move at wikis/_agents/moves/<id>/SKILL.md (portable). */
function seedPortableMove(vaultPath: string, moveId: string, summary: string): void {
  const dir = join(vaultPath, "wikis", "_agents", "moves", moveId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---
id: ${moveId}
type: move
title: ${moveId}
created: 2026-05-19
name: ${moveId}
description: ${summary}
summary: ${summary}
applies_to: [claude-code]
---

# ${moveId}
`,
    "utf8",
  );
}

/** Seed a wiki-local move at wikis/<wiki>/moves/<id>/SKILL.md. */
function seedWikiLocalMove(vaultPath: string, wiki: string, moveId: string, summary: string): void {
  const dir = join(vaultPath, "wikis", wiki, "moves", moveId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---
id: ${moveId}
type: move
title: ${moveId}
created: 2026-05-19
name: ${moveId}
description: ${summary}
summary: ${summary}
applies_to: [claude-code]
scope_wiki: [${wiki}]
---

# ${moveId}
`,
    "utf8",
  );
}

describe("integration — bootstrap-repo CLAUDE.md fragment renders Moveset sections", () => {
  let vaultPath: string;
  let repoPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-fr-"));
    repoPath = mkdtempSync(join(tmpdir(), "repo-fr-"));
    mkdirSync(join(vaultPath, "wikis", "crewtracks-modules"), { recursive: true });
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    rmSync(repoPath, { recursive: true, force: true });
  });

  it("renders both Portable and Specialist subsections when both layers are non-empty", async () => {
    seedProfile(vaultPath, "profile-charmeleon", ["move-tdd-cycle", "move-pr-create"]);
    seedPortableMove(vaultPath, "move-tdd-cycle", "Red-green-refactor with test-first discipline");
    seedPortableMove(vaultPath, "move-pr-create", "Open a PR for the current branch");
    seedWikiLocalMove(
      vaultPath,
      "crewtracks-modules",
      "move-add-crewtracks-module",
      "Scaffold a new CrewTracks module",
    );
    seedWikiLocalMove(
      vaultPath,
      "crewtracks-modules",
      "move-write-crewtracks-integration-test",
      "Write an integration test for CrewTracks",
    );

    await bootstrapRepoTool.handler(
      {
        repo_path: repoPath,
        wiki: "crewtracks-modules",
        pokemon: "profile-charmeleon",
        mcp_server_name: "vault",
      },
      { vaultPath },
    );

    const claudeMd = readFileSync(join(repoPath, "CLAUDE.md"), "utf8");

    // Header
    expect(claudeMd).toContain("## Moveset");
    // Portable subsection
    expect(claudeMd).toContain("### Portable moves");
    expect(claudeMd).toContain("- move-tdd-cycle — Red-green-refactor with test-first discipline");
    expect(claudeMd).toContain("- move-pr-create — Open a PR for the current branch");
    // Specialist subsection with wiki name interpolation
    expect(claudeMd).toContain("### Specialist moves (crewtracks-modules)");
    expect(claudeMd).toContain("- move-add-crewtracks-module — Scaffold a new CrewTracks module");
    expect(claudeMd).toContain(
      "- move-write-crewtracks-integration-test — Write an integration test for CrewTracks",
    );

    // Ordering: Portable subsection appears BEFORE Specialist subsection.
    const portableIdx = claudeMd.indexOf("### Portable moves");
    const specialistIdx = claudeMd.indexOf("### Specialist moves");
    expect(portableIdx).toBeGreaterThan(-1);
    expect(specialistIdx).toBeGreaterThan(portableIdx);

    // Whole Moveset block lives inside the v1.5 bootstrap fragment.
    const v15Start = claudeMd.indexOf("<!-- vault-mcp v1.5 bootstrap:start -->");
    const v15End = claudeMd.indexOf("<!-- /vault-mcp-bootstrap -->");
    const movesetIdx = claudeMd.indexOf("## Moveset");
    expect(v15Start).toBeGreaterThanOrEqual(0);
    expect(v15End).toBeGreaterThan(v15Start);
    expect(movesetIdx).toBeGreaterThan(v15Start);
    expect(movesetIdx).toBeLessThan(v15End);
  });

  it("omits the Specialist subsection when no wiki-local moves were synced", async () => {
    seedProfile(vaultPath, "profile-charmeleon", ["move-tdd-cycle"]);
    seedPortableMove(vaultPath, "move-tdd-cycle", "Red-green-refactor with test-first discipline");
    // No seedWikiLocalMove calls — wiki-local layer is empty.

    await bootstrapRepoTool.handler(
      {
        repo_path: repoPath,
        wiki: "crewtracks-modules",
        pokemon: "profile-charmeleon",
        mcp_server_name: "vault",
      },
      { vaultPath },
    );

    const claudeMd = readFileSync(join(repoPath, "CLAUDE.md"), "utf8");

    expect(claudeMd).toContain("## Moveset");
    expect(claudeMd).toContain("### Portable moves");
    expect(claudeMd).toContain("- move-tdd-cycle — Red-green-refactor with test-first discipline");

    // No empty Specialist heading must appear.
    expect(claudeMd).not.toContain("### Specialist moves");
  });

  it("omits the Portable subsection when the profile has no portable moveset", async () => {
    seedProfile(vaultPath, "profile-charmeleon", []); // empty moveset
    seedWikiLocalMove(
      vaultPath,
      "crewtracks-modules",
      "move-add-crewtracks-module",
      "Scaffold a new CrewTracks module",
    );

    await bootstrapRepoTool.handler(
      {
        repo_path: repoPath,
        wiki: "crewtracks-modules",
        pokemon: "profile-charmeleon",
        mcp_server_name: "vault",
      },
      { vaultPath },
    );

    const claudeMd = readFileSync(join(repoPath, "CLAUDE.md"), "utf8");

    expect(claudeMd).toContain("## Moveset");
    expect(claudeMd).toContain("### Specialist moves (crewtracks-modules)");
    expect(claudeMd).toContain("- move-add-crewtracks-module — Scaffold a new CrewTracks module");

    // No empty Portable heading.
    expect(claudeMd).not.toContain("### Portable moves");
  });

  it("omits the entire Moveset section when no pokemon is supplied", async () => {
    await bootstrapRepoTool.handler(
      {
        repo_path: repoPath,
        wiki: "crewtracks-modules",
        mcp_server_name: "vault",
      },
      { vaultPath },
    );

    const claudeMd = readFileSync(join(repoPath, "CLAUDE.md"), "utf8");
    // The v1.5 bootstrap block exists, but the Moveset block does not.
    expect(claudeMd).toContain("<!-- vault-mcp v1.5 bootstrap:start -->");
    expect(claudeMd).not.toContain("## Moveset");
    expect(claudeMd).not.toContain("### Portable moves");
    expect(claudeMd).not.toContain("### Specialist moves");
  });

  it("falls back to the move's description when summary is missing in frontmatter", async () => {
    // Seed a move WITHOUT `summary:` — the renderer should fall back to
    // `description:` (the existing frontmatter convention for moves) so the
    // bullet line is never bare.
    seedProfile(vaultPath, "profile-charmeleon", ["move-tdd-cycle"]);
    const dir = join(vaultPath, "wikis", "_agents", "moves", "move-tdd-cycle");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "SKILL.md"),
      `---
id: move-tdd-cycle
type: move
title: move-tdd-cycle
created: 2026-05-19
name: move-tdd-cycle
description: Falls back to description
applies_to: [claude-code]
---

# move-tdd-cycle
`,
      "utf8",
    );

    await bootstrapRepoTool.handler(
      {
        repo_path: repoPath,
        wiki: "crewtracks-modules",
        pokemon: "profile-charmeleon",
        mcp_server_name: "vault",
      },
      { vaultPath },
    );

    const claudeMd = readFileSync(join(repoPath, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain("- move-tdd-cycle — Falls back to description");
  });
});
