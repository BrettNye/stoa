// vault-mcp/tests/unit/bootstrap-repo-claim-render.test.ts
//
// task-bootstrap-repo-claim-rendering (Claims Plan 3, Wave 2) — wires §8.3 of
// the claims spec into vault.bootstrap-repo. The deploying profile's
// `## Learned (this profile)` section is rendered between
// `<!-- vault-claims-profile:start ... -->` and `<!-- vault-claims-profile:end -->`
// markers, co-located inside the existing `vault-mcp v1.5 bootstrap` block.
//
// Hermetic: every fixture under os.tmpdir() via mkTempVault helpers. `today`
// injected through ctx so byte-identical output is verifiable across re-runs.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapRepoTool } from "../../src/tools/bootstrap-repo.js";
import { mkTempVault, writeClaimFile } from "../helpers.js";

const TODAY = new Date("2026-05-03T00:00:00Z");

async function seedProfile(vaultPath: string, profileId: string): Promise<void> {
  // Minimal v1.5 profile fixture — readProfile only needs the file at the
  // expected path with a couple of frontmatter fields. We bypass writeProfile
  // here to avoid pulling the full pages/index machinery into the unit test.
  const profilesDir = join(vaultPath, "wikis", "_agents", "profiles");
  mkdirSync(profilesDir, { recursive: true });
  const yaml = [
    `id: ${profileId}`,
    `title: Test Profile`,
    `type: profile`,
    `wiki: _agents`,
    `status: active`,
    `created: 2026-05-02`,
    `updated: 2026-05-02`,
    `summary: test fixture`,
    `pokemon_type: fire`,
    `evolution_stage: basic`,
    `autonomy_level: restricted`,
    `moveset: []`,
  ].join("\n");
  writeFileSync(join(profilesDir, `${profileId}.md`), `---\n${yaml}\n---\n\n# Test\n`);
}

describe("vault.bootstrap-repo §8.3 vault-claims-profile rendering", () => {
  let vaultPath: string;
  let repoPath: string;

  beforeEach(async () => {
    vaultPath = await mkTempVault();
    repoPath = mkdtempSync(join(tmpdir(), "repo-br-claims-"));
    // bootstrap-repo writes .mcp.json and CLAUDE.md; ensure the wiki dir
    // expected by the existing bootstrap code is present.
    mkdirSync(join(vaultPath, "wikis", "alpha"), { recursive: true });
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    rmSync(repoPath, { recursive: true, force: true });
  });

  it("renders a vault-claims-profile section with one bullet for a profile-only active claim", async () => {
    await seedProfile(vaultPath, "profile-pikachu");
    await writeClaimFile(vaultPath, {
      id: "claim-prof-1",
      key: "k.profile.scoped",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      profile: ["profile-pikachu"],
      move: [],
    });

    await bootstrapRepoTool.handler(
      { repo_path: repoPath, wiki: "alpha", pokemon: "profile-pikachu" },
      { vaultPath, today: TODAY }
    );

    const claudeMd = readFileSync(join(repoPath, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain("<!-- vault-claims-profile:start");
    expect(claudeMd).toContain("<!-- vault-claims-profile:end -->");
    expect(claudeMd).toContain("## Learned (this profile)");
    expect(claudeMd).toContain("**`k.profile.scoped`**");
  });

  it("includes the staleness footer with the literal phrase 'more than <N> days old'", async () => {
    await seedProfile(vaultPath, "profile-pikachu");
    await writeClaimFile(vaultPath, {
      id: "claim-prof-1",
      key: "k.alpha",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      profile: ["profile-pikachu"],
      move: [],
    });

    await bootstrapRepoTool.handler(
      { repo_path: repoPath, wiki: "alpha", pokemon: "profile-pikachu" },
      { vaultPath, today: TODAY }
    );

    const claudeMd = readFileSync(join(repoPath, "CLAUDE.md"), "utf8");
    // Default staleness_warn_days is 30 per spec §6.2.
    expect(claudeMd).toContain("more than 30 days old");
  });

  it("uses the configured staleness_warn_days override in the footer", async () => {
    await seedProfile(vaultPath, "profile-pikachu");
    await writeClaimFile(vaultPath, {
      id: "claim-prof-1",
      key: "k.alpha",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      profile: ["profile-pikachu"],
      move: [],
    });

    await bootstrapRepoTool.handler(
      { repo_path: repoPath, wiki: "alpha", pokemon: "profile-pikachu" },
      { vaultPath, today: TODAY, rawConfig: { claims: { staleness_warn_days: 14 } } }
    );

    const claudeMd = readFileSync(join(repoPath, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain("more than 14 days old");
    expect(claudeMd).not.toContain("more than 30 days old");
  });

  it("filters out claims with non-empty move (move-specific claims do not appear in §8.3)", async () => {
    await seedProfile(vaultPath, "profile-pikachu");
    // Move-specific claim — even though profile matches, must be excluded.
    await writeClaimFile(vaultPath, {
      id: "claim-move-specific",
      key: "k.move.specific",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      profile: ["profile-pikachu"],
      move: ["move-tdd-cycle"],
    });
    // Profile-only claim — should appear.
    await writeClaimFile(vaultPath, {
      id: "claim-profile-only",
      key: "k.profile.only",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      profile: ["profile-pikachu"],
      move: [],
    });

    await bootstrapRepoTool.handler(
      { repo_path: repoPath, wiki: "alpha", pokemon: "profile-pikachu" },
      { vaultPath, today: TODAY }
    );

    const claudeMd = readFileSync(join(repoPath, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain("**`k.profile.only`**");
    expect(claudeMd).not.toContain("**`k.move.specific`**");
  });

  it("omits the §8.3 section entirely when zero profile-only claims qualify", async () => {
    await seedProfile(vaultPath, "profile-pikachu");
    // Only a move-specific claim — nothing qualifies for §8.3.
    await writeClaimFile(vaultPath, {
      id: "claim-move-specific",
      key: "k.move.only",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      profile: ["profile-pikachu"],
      move: ["move-tdd-cycle"],
    });

    await bootstrapRepoTool.handler(
      { repo_path: repoPath, wiki: "alpha", pokemon: "profile-pikachu" },
      { vaultPath, today: TODAY }
    );

    const claudeMd = readFileSync(join(repoPath, "CLAUDE.md"), "utf8");
    expect(claudeMd).not.toContain("vault-claims-profile:start");
    expect(claudeMd).not.toContain("vault-claims-profile:end");
    expect(claudeMd).not.toContain("## Learned (this profile)");
  });

  it("does not render the §8.3 section when no pokemon arg is given", async () => {
    await writeClaimFile(vaultPath, {
      id: "claim-prof-1",
      key: "k.alpha",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      profile: ["profile-pikachu"],
      move: [],
    });

    await bootstrapRepoTool.handler(
      { repo_path: repoPath, wiki: "alpha" },
      { vaultPath, today: TODAY }
    );

    const claudeMd = readFileSync(join(repoPath, "CLAUDE.md"), "utf8");
    expect(claudeMd).not.toContain("vault-claims-profile:start");
    expect(claudeMd).not.toContain("## Learned (this profile)");
  });

  it("co-locates the §8.3 section inside the existing v1.5 bootstrap block, preserving prior content", async () => {
    await seedProfile(vaultPath, "profile-pikachu");
    await writeClaimFile(vaultPath, {
      id: "claim-prof-1",
      key: "k.alpha",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      profile: ["profile-pikachu"],
      move: [],
    });

    await bootstrapRepoTool.handler(
      { repo_path: repoPath, wiki: "alpha", pokemon: "profile-pikachu", channels: ["alpha-progress"] },
      { vaultPath, today: TODAY }
    );

    const claudeMd = readFileSync(join(repoPath, "CLAUDE.md"), "utf8");
    // v1.5 bootstrap block markers are still present.
    expect(claudeMd).toContain("<!-- vault-mcp v1.5 bootstrap:start -->");
    expect(claudeMd).toContain("<!-- /vault-mcp-bootstrap -->");
    // Existing v1.5 stanza fields survive.
    expect(claudeMd).toContain("vault_start");
    expect(claudeMd).toContain("alpha-progress");
    // §8.3 section lives between the v1.5 markers (not appended after).
    const v15Start = claudeMd.indexOf("<!-- vault-mcp v1.5 bootstrap:start -->");
    const v15End = claudeMd.indexOf("<!-- /vault-mcp-bootstrap -->");
    const claimsStart = claudeMd.indexOf("<!-- vault-claims-profile:start");
    const claimsEnd = claudeMd.indexOf("<!-- vault-claims-profile:end -->");
    expect(claimsStart).toBeGreaterThan(v15Start);
    expect(claimsEnd).toBeLessThan(v15End);
  });

  it("is idempotent: re-running with the same corpus and same today yields a byte-identical CLAUDE.md", async () => {
    await seedProfile(vaultPath, "profile-pikachu");
    await writeClaimFile(vaultPath, {
      id: "claim-prof-1",
      key: "k.alpha",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      profile: ["profile-pikachu"],
      move: [],
    });

    const args = { repo_path: repoPath, wiki: "alpha", pokemon: "profile-pikachu" };
    const ctx = { vaultPath, today: TODAY };

    await bootstrapRepoTool.handler(args, ctx);
    const first = readFileSync(join(repoPath, "CLAUDE.md"), "utf8");
    await bootstrapRepoTool.handler(args, ctx);
    const second = readFileSync(join(repoPath, "CLAUDE.md"), "utf8");
    expect(second).toBe(first);
    // Third pass for paranoia.
    await bootstrapRepoTool.handler(args, ctx);
    const third = readFileSync(join(repoPath, "CLAUDE.md"), "utf8");
    expect(third).toBe(first);
  });

  it("defaults today to new Date() and rawConfig to {} when ctx omits both", async () => {
    await seedProfile(vaultPath, "profile-pikachu");
    await writeClaimFile(vaultPath, {
      id: "claim-prof-1",
      key: "k.alpha",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      profile: ["profile-pikachu"],
      move: [],
    });

    // ctx without today / rawConfig — must not throw, must produce a §8.3
    // section with the default 30-day staleness footer.
    await bootstrapRepoTool.handler(
      { repo_path: repoPath, wiki: "alpha", pokemon: "profile-pikachu" },
      { vaultPath }
    );
    const claudeMd = readFileSync(join(repoPath, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain("vault-claims-profile:start");
    expect(claudeMd).toContain("more than 30 days old");
  });
});
