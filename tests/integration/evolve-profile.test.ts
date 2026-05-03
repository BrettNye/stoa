import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { evolveProfileTool } from "../../src/tools/evolve-profile.js";
import { reindex } from "../../src/core/reindex.js";
import { parseFrontmatter } from "../../src/core/frontmatter.js";
import { readAliases } from "../../src/core/aliases.js";

async function seedVaultWithProfileAndCompletedTasks(vaultPath: string, taskCount: number, succeedCount: number): Promise<void> {
  const profilesDir = join(vaultPath, "wikis", "_agents", "profiles");
  mkdirSync(profilesDir, { recursive: true });
  const tasksDir = join(vaultPath, "wikis", "alpha", "tasks");
  mkdirSync(tasksDir, { recursive: true });
  mkdirSync(join(vaultPath, "_index"), { recursive: true });

  writeFileSync(join(profilesDir, "profile-charmander.md"),
    `---
id: profile-charmander
title: Charmander
type: profile
wiki: _agents
status: active
created: 2026-01-01
updated: 2026-04-30
summary: Backend
pokemon_type: fire
evolution_stage: basic
autonomy_level: restricted
moveset: [move-tdd-cycle]
applies_to: [claude-code]
---
`);

  for (let i = 0; i < taskCount; i++) {
    const status = i < succeedCount ? "completed" : "failed";
    writeFileSync(join(tasksDir, `task-fixture-${i}.md`),
      `---
id: task-fixture-${i}
title: fixture task ${i}
type: task
wiki: alpha
status: ${status}
created: 2026-04-01
updated: 2026-04-01
claimed_by: agent:charmander
---
`);
  }

  await reindex(vaultPath);
}

describe("vault.evolve-profile", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-evolve-"));
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("proposal phase returns eligible:false when thresholds not met", async () => {
    await seedVaultWithProfileAndCompletedTasks(vaultPath, 5, 5);  // only 5 completed, need 30
    const r = await evolveProfileTool.handler(
      { pokemon_id: "profile-charmander", commit: false },
      { vaultPath }
    );
    expect(r.eligible).toBe(false);
    expect(r.proposed.evolution_stage).toBe("stage1");  // proposed shape still well-formed
  });

  it("proposal phase returns eligible:true when 30+ completed at >=80% success", async () => {
    await seedVaultWithProfileAndCompletedTasks(vaultPath, 30, 30);  // 30 completed at 100% success
    const r = await evolveProfileTool.handler(
      { pokemon_id: "profile-charmander", commit: false },
      { vaultPath }
    );
    expect(r.eligible).toBe(true);
    expect(r.proposed.evolution_stage).toBe("stage1");
    expect(r.proposed.autonomy_level).toBe("feature-branch");
    expect(r.proposed.name).toBeNull();  // C.1a no rename
  });

  it("commit phase without name updates frontmatter in place (no rename)", async () => {
    await seedVaultWithProfileAndCompletedTasks(vaultPath, 30, 30);
    const profilePath = join(vaultPath, "wikis", "_agents", "profiles", "profile-charmander.md");
    const before = parseFrontmatter(readFileSync(profilePath, "utf8"));
    const proposalResp = await evolveProfileTool.handler(
      { pokemon_id: "profile-charmander", commit: false },
      { vaultPath }
    );

    const r = await evolveProfileTool.handler(
      {
        pokemon_id: "profile-charmander",
        commit: true,
        expected_updated: String(before.frontmatter.updated),
        proposal: proposalResp
      },
      { vaultPath }
    );

    expect(r.old_id).toBe("profile-charmander");
    expect(r.new_id).toBe("profile-charmander");  // no rename
    expect(r.alias_recorded).toBe(false);

    // File still at old path with updated frontmatter
    expect(existsSync(profilePath)).toBe(true);
    const after = parseFrontmatter(readFileSync(profilePath, "utf8"));
    expect(after.frontmatter.evolution_stage).toBe("stage1");
    expect(after.frontmatter.autonomy_level).toBe("feature-branch");
  });

  it("commit phase with a non-null name in proposal renames the profile and records the alias", async () => {
    await seedVaultWithProfileAndCompletedTasks(vaultPath, 30, 30);
    const profilePath = join(vaultPath, "wikis", "_agents", "profiles", "profile-charmander.md");
    const before = parseFrontmatter(readFileSync(profilePath, "utf8"));
    const proposalResp = await evolveProfileTool.handler(
      { pokemon_id: "profile-charmander", commit: false },
      { vaultPath }
    );

    // User edits the proposal to provide a name
    const userEdited = { ...proposalResp, proposed: { ...proposalResp.proposed, name: "profile-charmeleon" } };

    const r = await evolveProfileTool.handler(
      {
        pokemon_id: "profile-charmander",
        commit: true,
        expected_updated: String(before.frontmatter.updated),
        proposal: userEdited
      },
      { vaultPath }
    );

    expect(r.old_id).toBe("profile-charmander");
    expect(r.new_id).toBe("profile-charmeleon");
    expect(r.alias_recorded).toBe(true);
    expect(existsSync(profilePath)).toBe(false);
    const newPath = join(vaultPath, "wikis", "_agents", "profiles", "profile-charmeleon.md");
    expect(existsSync(newPath)).toBe(true);

    // Alias index updated
    const aliases = readAliases(vaultPath);
    expect(aliases["profile-charmander"]?.current).toBe("profile-charmeleon");
  });

  it("commit phase rejects on expected_updated mismatch (OCC)", async () => {
    await seedVaultWithProfileAndCompletedTasks(vaultPath, 30, 30);
    const proposalResp = await evolveProfileTool.handler(
      { pokemon_id: "profile-charmander", commit: false },
      { vaultPath }
    );
    await expect(
      evolveProfileTool.handler(
        {
          pokemon_id: "profile-charmander",
          commit: true,
          expected_updated: "1999-01-01",  // wrong
          proposal: proposalResp
        },
        { vaultPath }
      )
    ).rejects.toThrow(/conflict|OCC|expected_updated/i);
  });

  it("proposal phase emits the claim-driven rationale shape when no claims are seeded (vaultPath always threaded post-Plan 2)", async () => {
    // Plan 2 (commit 41c8acf) made the evolve-profile handler ALWAYS thread
    // `vaultPath` into `proposeEvolution`, which routes to `enrichWithClaims`
    // for the rationale. The previous v1.5 behavior — `memory_page_id` cited
    // inline (`memory: [[synthesis-<bare>-memory]]`) and the task count (e.g.
    // `30`) embedded in the rationale — was a property of the legacy
    // stats-driven `computeLegacyProposal` rationale, which Plan 2 replaces.
    //
    // The original assertion (`r.rationale.toMatch(/synthesis-charmander-memory/)`)
    // is no longer satisfiable: `enrichWithClaims` never reads `memory_page_id`
    // when building the rationale. The substantive intent of this test —
    // "the rationale path runs successfully with synthesis fixture present" —
    // remains, so we keep the synthesis seed but assert on the new rationale
    // shape (which is the only output the rationale path produces today).
    await seedVaultWithProfileAndCompletedTasks(vaultPath, 30, 30);
    const synthDir = join(vaultPath, "wikis", "_agents", "synthesis");
    mkdirSync(synthDir, { recursive: true });
    writeFileSync(join(synthDir, "synthesis-charmander-memory.md"),
      `---
id: synthesis-charmander-memory
title: charmander memory — synthesis
type: synthesis
wiki: _agents
status: draft
created: 2026-04-30
updated: 2026-04-30
summary: charmander memory
scope: memory
by_agent: charmander
---
charmander has shown a pattern of refactoring during long sprints.
`);

    const r = await evolveProfileTool.handler(
      { pokemon_id: "profile-charmander", commit: false },
      { vaultPath }
    );

    // Stats-driven legacy `eligible` flag still holds (30 tasks at 100%).
    expect(r.eligible).toBe(true);
    // Claim-driven rationale shape per `core/evolution-claims.ts:renderRationale`.
    // No claims seeded → "0 active claims, of which 0 exceed the …".
    expect(r.rationale).toMatch(
      /Profile profile-charmander has authored 0 active claims/
    );
    expect(r.rationale).toMatch(/Eligibility check: not eligible for basic/);
    // memory_page_id is no longer a rationale input under the claim-driven path.
    expect(r.rationale).not.toMatch(/synthesis-charmander-memory/);
  });

  it("proposal phase emits a well-formed claim-driven rationale when memory page is absent (no v1.5 stats text injected)", async () => {
    // Companion to the previous test: same fixture but without the synthesis
    // page on disk. The output is identical because `enrichWithClaims`
    // doesn't consult `memory_page_id`. Pre-Plan-2 this assertion checked
    // the v1.5 rationale embedded the literal `30` (task count); under the
    // claim-driven path the rationale has no task count at all (the count
    // it DOES surface is `active claims`, not `tasks_completed`).
    await seedVaultWithProfileAndCompletedTasks(vaultPath, 30, 30);
    const r = await evolveProfileTool.handler(
      { pokemon_id: "profile-charmander", commit: false },
      { vaultPath }
    );

    expect(r.eligible).toBe(true);
    expect(r.rationale).not.toMatch(/synthesis-charmander-memory/);
    // The new rationale is claim-driven; no claims seeded → 0 active claims.
    expect(r.rationale).toMatch(/0 active claims/);
    expect(r.rationale).toMatch(/effective-confidence threshold/);
  });

  it("commit phase auto-resyncs to deployed repos when registry has entries", async () => {
    await seedVaultWithProfileAndCompletedTasks(vaultPath, 30, 30);
    const repoPath = join(vaultPath, "_fake_repo");
    mkdirSync(join(repoPath, ".claude", "skills", "charmander"), { recursive: true });
    mkdirSync(join(vaultPath, "wikis", "_agents", "moves", "move-tdd-cycle"), { recursive: true });
    writeFileSync(join(vaultPath, "wikis", "_agents", "moves", "move-tdd-cycle", "SKILL.md"),
      `---
id: move-tdd-cycle
name: tdd-cycle
type: move
wiki: _agents
status: active
description: red-green-refactor
applies_to: [claude-code]
---
TDD content.
`);
    writeFileSync(join(vaultPath, "_index", "deployments.json"), JSON.stringify({
      "profile-charmander": [{
        repo_path: repoPath,
        target: "claude-code",
        mode: "copy",
        synced_at: "2026-04-29T00:00:00Z"
      }]
    }, null, 2));

    const before = parseFrontmatter(readFileSync(join(vaultPath, "wikis", "_agents", "profiles", "profile-charmander.md"), "utf8"));
    const proposal = await evolveProfileTool.handler(
      { pokemon_id: "profile-charmander", commit: false },
      { vaultPath }
    );

    const r = await evolveProfileTool.handler(
      {
        pokemon_id: "profile-charmander",
        commit: true,
        expected_updated: String(before.frontmatter.updated),
        proposal
      },
      { vaultPath }
    );

    expect(r.files_resynced.length).toBe(1);
    expect(r.files_resynced[0].repo).toBe(repoPath);
  });

  it("commit phase migrates deployment registry key on rename", async () => {
    await seedVaultWithProfileAndCompletedTasks(vaultPath, 30, 30);
    writeFileSync(join(vaultPath, "_index", "deployments.json"), JSON.stringify({
      "profile-charmander": [{
        repo_path: "/fake/repo",
        target: "claude-code",
        mode: "symlink",
        synced_at: "2026-04-29T00:00:00Z"
      }]
    }, null, 2));

    const before = parseFrontmatter(readFileSync(join(vaultPath, "wikis", "_agents", "profiles", "profile-charmander.md"), "utf8"));
    const proposal = await evolveProfileTool.handler(
      { pokemon_id: "profile-charmander", commit: false },
      { vaultPath }
    );
    const userEdited = { ...proposal, proposed: { ...proposal.proposed, name: "profile-charmeleon" } };

    await evolveProfileTool.handler(
      {
        pokemon_id: "profile-charmander",
        commit: true,
        expected_updated: String(before.frontmatter.updated),
        proposal: userEdited
      },
      { vaultPath }
    );

    const reg = JSON.parse(readFileSync(join(vaultPath, "_index", "deployments.json"), "utf8"));
    expect(reg["profile-charmeleon"]).toBeDefined();
    expect(reg["profile-charmander"]).toBeUndefined();
  });

  it("commit phase no-ops auto-resync when deployments.json is missing", async () => {
    await seedVaultWithProfileAndCompletedTasks(vaultPath, 30, 30);
    const before = parseFrontmatter(readFileSync(join(vaultPath, "wikis", "_agents", "profiles", "profile-charmander.md"), "utf8"));
    const proposal = await evolveProfileTool.handler(
      { pokemon_id: "profile-charmander", commit: false },
      { vaultPath }
    );
    const r = await evolveProfileTool.handler(
      {
        pokemon_id: "profile-charmander",
        commit: true,
        expected_updated: String(before.frontmatter.updated),
        proposal
      },
      { vaultPath }
    );
    expect(r.files_resynced).toEqual([]);
  });

  it("proposal phase honours custom thresholds from wikis/_agents/CLAUDE.md", async () => {
    // Seed 8 successful tasks: well below the default 30-task threshold,
    // but above a custom 5-task threshold the operator declares.
    await seedVaultWithProfileAndCompletedTasks(vaultPath, 8, 8);

    // No CLAUDE.md present yet → default thresholds → not eligible at 8 tasks.
    const beforeOverride = await evolveProfileTool.handler(
      { pokemon_id: "profile-charmander", commit: false },
      { vaultPath }
    );
    expect(beforeOverride.eligible).toBe(false);

    // Drop a custom threshold block at wikis/_agents/CLAUDE.md.
    const agentsDir = join(vaultPath, "wikis", "_agents");
    mkdirSync(agentsDir, { recursive: true });
    const customClaudeMd = `# _agents — wiki conventions

Some prose.

\`\`\`yaml evolution_thresholds
basic_to_stage1:
  tasks_completed: 5
  success_rate: 0.50
stage1_to_stage2:
  tasks_completed: 100
  success_rate: 0.85
\`\`\`

More prose.
`;
    writeFileSync(join(agentsDir, "CLAUDE.md"), customClaudeMd);

    // With override: 8 tasks at 100% success satisfies the 5/0.50 gate → eligible.
    const withOverride = await evolveProfileTool.handler(
      { pokemon_id: "profile-charmander", commit: false },
      { vaultPath }
    );
    expect(withOverride.eligible).toBe(true);
    expect(withOverride.proposed.evolution_stage).toBe("stage1");

    // Remove the override and re-verify: back to ineligible.
    rmSync(join(agentsDir, "CLAUDE.md"));
    const afterRemoval = await evolveProfileTool.handler(
      { pokemon_id: "profile-charmander", commit: false },
      { vaultPath }
    );
    expect(afterRemoval.eligible).toBe(false);
  });

  it("proposal phase falls back to defaults when threshold block is invalid", async () => {
    await seedVaultWithProfileAndCompletedTasks(vaultPath, 30, 30);

    const agentsDir = join(vaultPath, "wikis", "_agents");
    mkdirSync(agentsDir, { recursive: true });
    // Malformed YAML in the fence — tool must catch ThresholdBlockError and fall back to defaults.
    const brokenClaudeMd = `\`\`\`yaml evolution_thresholds
basic_to_stage1:
  tasks_completed: not-a-number
  success_rate: 0.80
stage1_to_stage2:
  tasks_completed: 100
  success_rate: 0.85
\`\`\`
`;
    writeFileSync(join(agentsDir, "CLAUDE.md"), brokenClaudeMd);

    // Defaults of 30/0.80 still apply → eligible at 30/100% success.
    const r = await evolveProfileTool.handler(
      { pokemon_id: "profile-charmander", commit: false },
      { vaultPath }
    );
    expect(r.eligible).toBe(true);
  });

  it("commit phase with cleanup_old_skills_dir:true removes pre-rename skills dir on rename", async () => {
    await seedVaultWithProfileAndCompletedTasks(vaultPath, 30, 30);
    const repoPath = join(vaultPath, "_fake_repo");
    const oldSkillsDir = join(repoPath, ".claude", "skills", "charmander");
    mkdirSync(oldSkillsDir, { recursive: true });
    writeFileSync(join(oldSkillsDir, "_pokemon.json"), "{}");

    // Seed move so re-deploy under new id has something to sync.
    mkdirSync(join(vaultPath, "wikis", "_agents", "moves", "move-tdd-cycle"), { recursive: true });
    writeFileSync(join(vaultPath, "wikis", "_agents", "moves", "move-tdd-cycle", "SKILL.md"),
      `---
id: move-tdd-cycle
name: tdd-cycle
type: move
wiki: _agents
status: active
description: red-green-refactor
applies_to: [claude-code]
---
TDD content.
`);

    writeFileSync(join(vaultPath, "_index", "deployments.json"), JSON.stringify({
      "profile-charmander": [{
        repo_path: repoPath,
        target: "claude-code",
        mode: "copy",
        synced_at: "2026-04-29T00:00:00Z"
      }]
    }, null, 2));

    const before = parseFrontmatter(readFileSync(join(vaultPath, "wikis", "_agents", "profiles", "profile-charmander.md"), "utf8"));
    const proposal = await evolveProfileTool.handler(
      { pokemon_id: "profile-charmander", commit: false },
      { vaultPath }
    );
    const userEdited = { ...proposal, proposed: { ...proposal.proposed, name: "profile-charmeleon" } };

    await evolveProfileTool.handler(
      {
        pokemon_id: "profile-charmander",
        commit: true,
        expected_updated: String(before.frontmatter.updated),
        proposal: userEdited,
        cleanup_old_skills_dir: true
      },
      { vaultPath }
    );

    // Old skills dir gone, new one present
    expect(existsSync(oldSkillsDir)).toBe(false);
    const newSkillsDir = join(repoPath, ".claude", "skills", "charmeleon");
    expect(existsSync(newSkillsDir)).toBe(true);

    // Registry migrated
    const reg = JSON.parse(readFileSync(join(vaultPath, "_index", "deployments.json"), "utf8"));
    expect(reg["profile-charmeleon"]).toBeDefined();
    expect(reg["profile-charmander"]).toBeUndefined();
  });

  it("commit phase with cleanup_old_skills_dir:false leaves pre-rename skills dir intact", async () => {
    await seedVaultWithProfileAndCompletedTasks(vaultPath, 30, 30);
    const repoPath = join(vaultPath, "_fake_repo");
    const oldSkillsDir = join(repoPath, ".claude", "skills", "charmander");
    mkdirSync(oldSkillsDir, { recursive: true });
    writeFileSync(join(oldSkillsDir, "_pokemon.json"), "{}");

    mkdirSync(join(vaultPath, "wikis", "_agents", "moves", "move-tdd-cycle"), { recursive: true });
    writeFileSync(join(vaultPath, "wikis", "_agents", "moves", "move-tdd-cycle", "SKILL.md"),
      `---
id: move-tdd-cycle
name: tdd-cycle
type: move
wiki: _agents
status: active
description: red-green-refactor
applies_to: [claude-code]
---
TDD content.
`);

    writeFileSync(join(vaultPath, "_index", "deployments.json"), JSON.stringify({
      "profile-charmander": [{
        repo_path: repoPath,
        target: "claude-code",
        mode: "copy",
        synced_at: "2026-04-29T00:00:00Z"
      }]
    }, null, 2));

    const before = parseFrontmatter(readFileSync(join(vaultPath, "wikis", "_agents", "profiles", "profile-charmander.md"), "utf8"));
    const proposal = await evolveProfileTool.handler(
      { pokemon_id: "profile-charmander", commit: false },
      { vaultPath }
    );
    const userEdited = { ...proposal, proposed: { ...proposal.proposed, name: "profile-charmeleon" } };

    await evolveProfileTool.handler(
      {
        pokemon_id: "profile-charmander",
        commit: true,
        expected_updated: String(before.frontmatter.updated),
        proposal: userEdited,
        cleanup_old_skills_dir: false
      },
      { vaultPath }
    );

    // Old skills dir REMAINS
    expect(existsSync(oldSkillsDir)).toBe(true);
  });

  it("commit phase defaults cleanup_old_skills_dir to true when omitted", async () => {
    await seedVaultWithProfileAndCompletedTasks(vaultPath, 30, 30);
    const repoPath = join(vaultPath, "_fake_repo");
    const oldSkillsDir = join(repoPath, ".claude", "skills", "charmander");
    mkdirSync(oldSkillsDir, { recursive: true });
    writeFileSync(join(oldSkillsDir, "_pokemon.json"), "{}");

    mkdirSync(join(vaultPath, "wikis", "_agents", "moves", "move-tdd-cycle"), { recursive: true });
    writeFileSync(join(vaultPath, "wikis", "_agents", "moves", "move-tdd-cycle", "SKILL.md"),
      `---
id: move-tdd-cycle
name: tdd-cycle
type: move
wiki: _agents
status: active
description: red-green-refactor
applies_to: [claude-code]
---
TDD content.
`);

    writeFileSync(join(vaultPath, "_index", "deployments.json"), JSON.stringify({
      "profile-charmander": [{
        repo_path: repoPath,
        target: "claude-code",
        mode: "copy",
        synced_at: "2026-04-29T00:00:00Z"
      }]
    }, null, 2));

    const before = parseFrontmatter(readFileSync(join(vaultPath, "wikis", "_agents", "profiles", "profile-charmander.md"), "utf8"));
    const proposal = await evolveProfileTool.handler(
      { pokemon_id: "profile-charmander", commit: false },
      { vaultPath }
    );
    const userEdited = { ...proposal, proposed: { ...proposal.proposed, name: "profile-charmeleon" } };

    // No cleanup_old_skills_dir provided → default true
    await evolveProfileTool.handler(
      {
        pokemon_id: "profile-charmander",
        commit: true,
        expected_updated: String(before.frontmatter.updated),
        proposal: userEdited
      },
      { vaultPath }
    );

    expect(existsSync(oldSkillsDir)).toBe(false);
  });

  it("proposal phase sets proposed.name from PokeAPI chain when fetcher is supplied", async () => {
    await seedVaultWithProfileAndCompletedTasks(vaultPath, 30, 30);
    const charmanderResp = {
      name: "charmander",
      types: [{ type: { name: "fire" } }],
      species: { url: "https://pokeapi.co/api/v2/pokemon-species/4/" },
      sprites: { front_default: null }
    };
    const speciesResp = { evolution_chain: { url: "https://pokeapi.co/api/v2/evolution-chain/2/" } };
    const chainResp = {
      chain: {
        species: { name: "charmander", url: "" },
        evolves_to: [{
          species: { name: "charmeleon", url: "" },
          evolves_to: []
        }]
      }
    };
    const fetcher: typeof fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/pokemon/charmander")) return new Response(JSON.stringify(charmanderResp), { status: 200 });
      if (u.includes("/pokemon-species/4/")) return new Response(JSON.stringify(speciesResp), { status: 200 });
      if (u.includes("/evolution-chain/2/")) return new Response(JSON.stringify(chainResp), { status: 200 });
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const r = await evolveProfileTool.handler(
      { pokemon_id: "profile-charmander", commit: false },
      { vaultPath, fetcher }
    );
    expect(r.eligible).toBe(true);
    expect(r.proposed.name).toBe("profile-charmeleon");
  });
});
