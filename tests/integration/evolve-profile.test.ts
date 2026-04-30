import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { evolveProfileTool } from "../../src/tools/evolve-profile.js";
import { reindex } from "../../src/core/reindex.js";
import { parseFrontmatter } from "../../src/core/frontmatter.js";
import { readAliases } from "../../src/core/aliases.js";

function seedVaultWithProfileAndCompletedTasks(vaultPath: string, taskCount: number, succeedCount: number): void {
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

  reindex(vaultPath);
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
    seedVaultWithProfileAndCompletedTasks(vaultPath, 5, 5);  // only 5 completed, need 30
    const r = await evolveProfileTool.handler(
      { pokemon_id: "profile-charmander", commit: false },
      { vaultPath }
    );
    expect(r.eligible).toBe(false);
    expect(r.proposed.evolution_stage).toBe("stage1");  // proposed shape still well-formed
  });

  it("proposal phase returns eligible:true when 30+ completed at >=80% success", async () => {
    seedVaultWithProfileAndCompletedTasks(vaultPath, 30, 30);  // 30 completed at 100% success
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
    seedVaultWithProfileAndCompletedTasks(vaultPath, 30, 30);
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
    seedVaultWithProfileAndCompletedTasks(vaultPath, 30, 30);
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
    seedVaultWithProfileAndCompletedTasks(vaultPath, 30, 30);
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
});
