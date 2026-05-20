// vault-mcp/tests/integration/bootstrap-repo-claims.test.ts
//
// task-bootstrap-repo-integration-test (Claims Plan 3, Wave 3) — end-to-end
// coverage of the §8.3 "Learned (this profile)" section that
// `vault_bootstrap-repo` embeds inside the v1.5 bootstrap fragment in the
// target repo's CLAUDE.md when a `pokemon` is being deployed.
//
// Five acceptance criteria, mapped to the five `it()` blocks below:
//   1. Profile-only claim (`profile: ["profile-x"]`, `move: []`) for the
//      deploying profile renders the full marker-bounded block with start
//      marker, `## Learned (this profile)` heading, a bullet for the claim,
//      the staleness footer matching `/more than 30 days old/`, and the
//      end marker.
//   2. A move-specific claim (`profile: ["profile-x"]`, `move: ["move-x"]`)
//      attributed to the same profile is FILTERED OUT by the `move == []`
//      rule in `bootstrap-repo.renderProfileLearnedSection`.
//   3. Re-running with the same corpus and the same injected `today` produces
//      byte-identical CLAUDE.md content (idempotency).
//   4. Calling `vault_bootstrap-repo` WITHOUT `pokemon` writes a CLAUDE.md
//      whose v1.5 bootstrap block contains NO `vault-claims-profile` marker
//      (the §8.3 section only exists when a profile is being deployed).
//   5. Calling `vault_bootstrap-repo` for a profile that has zero
//      profile-only claims (only move-specific or none at all) writes a
//      CLAUDE.md whose v1.5 bootstrap block contains NO
//      `vault-claims-profile` marker (the renderer returns null when no
//      claims qualify, and the caller skips the markers in that case).
//
// Pattern: handler-direct invocation (mirrors evolve-profile-claims.test.ts
// in this same plan wave, and synthesize-by-agent-claims.test.ts upstream).
// `callTool` from tests/helpers.ts hard-codes `rawConfig: {}` and bypasses
// Zod, but bootstrap-repo's handler reads `ctx.today` for the staleness
// footer's render-date and for decay calculations — we must inject `today`
// directly. So we call `bootstrapRepoTool.handler(input, { vaultPath, today,
// rawConfig: {} } as any)` with `as any` to satisfy the implicit `ctx`
// interface (handler ctx is `{ vaultPath, today?, rawConfig? }`; the `as any`
// matches the convention in the dispatched task brief).
//
// Hermetic: every test runs against an `mkTempVault` under `os.tmpdir()` and
// a sibling temp repo dir; nothing reads or writes the live vault root.
// Cleanup is afterEach via `rmSync(_, { recursive: true, force: true })`.
//
// Date discipline: `vi.useFakeTimers()` + `vi.setSystemTime()` patches the
// global Date constructor inside each test that needs it. The handler
// receives an explicit `today` so production-clock reads (the
// `today ?? new Date()` fallback at bootstrap-repo.ts:195) never fire here,
// but seeding `vi.setSystemTime` matches the discipline of the upstream
// integration tests in this DAG (synthesize-by-agent-claims, evolve-profile-
// claims) so a regression to silent `Date.now()` reads in adjacent code
// would still be caught.

import { describe, it, expect, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import { rmSync } from "node:fs";
import path from "node:path";
import { mkTempVault, writeClaimFile } from "../helpers.js";
import { bootstrapRepoTool } from "../../src/tools/bootstrap-repo.js";
import {
  buildClaimsIndex,
  writeClaimsIndex,
} from "../../src/core/claims-index.js";

/**
 * Write a minimal profile page under `wikis/_agents/profiles/<id>.md`.
 * `bootstrap-repo` calls `readProfile(vault, pokemon)` which throws
 * `ProfileNotFoundError` unless the on-disk page exists with `id`/`type`/
 * `wiki` frontmatter. `moveset: []` keeps `syncMoveset` a cheap no-op so
 * the test exercises only the §8.3 rendering path, not the skills path.
 */
async function seedProfile(vault: string, profileId: string): Promise<void> {
  const profileDir = path.join(vault, "wikis", "_agents", "profiles");
  await fs.mkdir(profileDir, { recursive: true });
  await fs.writeFile(
    path.join(profileDir, `${profileId}.md`),
    `---\nid: ${profileId}\ntype: profile\ntitle: ${profileId}\ncreated: 2026-04-29\nwiki: _agents\nstatus: active\nsummary: test\npokemon_type: ghost\nevolution_stage: basic\nmoveset: []\napplies_to: [claude-code]\n---\n\n# ${profileId}\n`,
    "utf8",
  );
}

/**
 * Make a fresh temp repo dir under the vault and return its absolute path.
 * Living under the vault root keeps cleanup a single recursive rm of the
 * vault, but the bootstrap-repo handler treats `repo_path` as opaque so the
 * location doesn't affect the test outcome.
 */
async function mkRepoUnder(vault: string, name: string): Promise<string> {
  const repo = path.join(vault, name);
  await fs.mkdir(repo, { recursive: true });
  return repo;
}

describe("vault_bootstrap-repo §8.3 profile-claims rendering integration", () => {
  // Track every temp vault we create so a failing test doesn't leak
  // gigabyte-sized tmpdirs across CI runs.
  const created: string[] = [];
  afterEach(() => {
    while (created.length > 0) {
      const v = created.pop()!;
      try {
        rmSync(v, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
  });

  it("embeds vault-claims-profile section in CLAUDE.md when a profile-only claim exists for the deploying profile", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-04-30T12:00:00Z"));
      const vault = await mkTempVault();
      created.push(vault);
      await seedProfile(vault, "profile-x");

      // Profile-only claim: profile attributed, move empty → §8.3 eligible.
      // `last_validated: 2026-04-30` matches the injected `today` so decay
      // is exactly 0 days and the displayed effective confidence is the raw
      // 0.8 → 0.80 in the rendered bullet (see formatClaimBullet:181).
      await writeClaimFile(vault, {
        id: "claim-p1",
        key: "profile.k1",
        status: "active",
        confidence: 0.8,
        profile: ["profile-x"],
        move: [],
        evidence: ["[[journal-p1]]"],
        last_validated: "2026-04-30",
      });
      await writeClaimsIndex(vault, await buildClaimsIndex(vault));

      const repo = await mkRepoUnder(vault, "tmp-repo-1");
      await bootstrapRepoTool.handler(
        {
          repo_path: repo,
          wiki: "_agents",
          pokemon: "profile-x",
          mcp_server_name: "vault",
        },
        {
          vaultPath: vault,
          today: new Date("2026-04-30T12:00:00Z"),
          rawConfig: {},
        } as any,
      );

      const claudeMd = await fs.readFile(path.join(repo, "CLAUDE.md"), "utf8");

      // Acceptance criterion 1: full §8.3 block is present.
      expect(claudeMd).toContain("<!-- vault-claims-profile:start");
      expect(claudeMd).toContain("## Learned (this profile)");
      expect(claudeMd).toContain("`profile.k1`");
      // The footer text in bootstrap-repo.ts:63 reads:
      //   "*If `vault-claims-profile rendered:` is more than 30 days old, …"
      // The literal regex `/more than 30 days old/` from the task brief.
      expect(claudeMd).toMatch(/more than 30 days old/);
      expect(claudeMd).toContain("<!-- vault-claims-profile:end -->");

      // The §8.3 block must live INSIDE the v1.5 bootstrap fragment (not
      // appended after the closing marker). See bootstrap-repo.ts:109-112.
      const v15Start = claudeMd.indexOf(
        "<!-- vault-mcp v1.5 bootstrap:start -->",
      );
      const v15End = claudeMd.indexOf("<!-- /vault-mcp-bootstrap -->");
      const claimsStart = claudeMd.indexOf("<!-- vault-claims-profile:start");
      const claimsEnd = claudeMd.indexOf("<!-- vault-claims-profile:end -->");
      expect(v15Start).toBeGreaterThanOrEqual(0);
      expect(v15End).toBeGreaterThan(v15Start);
      expect(claimsStart).toBeGreaterThan(v15Start);
      expect(claimsEnd).toBeGreaterThan(claimsStart);
      expect(claimsEnd).toBeLessThan(v15End);

      // The render-date in the start marker matches the injected `today`.
      expect(claudeMd).toContain("rendered: 2026-04-30");
      // Default config exposes 75-day half-life in the marker.
      expect(claudeMd).toContain("half-life: 75d");
    } finally {
      vi.useRealTimers();
    }
  });

  it("filters out move-specific claims (move != []) even when attributed to the deploying profile", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-04-30T12:00:00Z"));
      const vault = await mkTempVault();
      created.push(vault);
      await seedProfile(vault, "profile-x");

      // Profile-only claim — should appear.
      await writeClaimFile(vault, {
        id: "claim-profile-only",
        key: "profile.only",
        status: "active",
        confidence: 0.8,
        profile: ["profile-x"],
        move: [],
        evidence: ["[[journal-pf]]"],
        last_validated: "2026-04-30",
      });
      // Move-specific claim — same profile, but move is populated. The
      // §8.3 filter at bootstrap-repo.ts:44 (`(c.move ?? []).length === 0`)
      // must drop this from the rendered section.
      await writeClaimFile(vault, {
        id: "claim-move-specific",
        key: "move.specific",
        status: "active",
        confidence: 0.9,
        profile: ["profile-x"],
        move: ["move-x"],
        evidence: ["[[journal-mv]]"],
        last_validated: "2026-04-30",
      });
      await writeClaimsIndex(vault, await buildClaimsIndex(vault));

      const repo = await mkRepoUnder(vault, "tmp-repo-2");
      await bootstrapRepoTool.handler(
        {
          repo_path: repo,
          wiki: "_agents",
          pokemon: "profile-x",
          mcp_server_name: "vault",
        },
        {
          vaultPath: vault,
          today: new Date("2026-04-30T12:00:00Z"),
          rawConfig: {},
        } as any,
      );

      const claudeMd = await fs.readFile(path.join(repo, "CLAUDE.md"), "utf8");

      // The profile-only claim's key appears. The move-specific claim's key
      // and id do NOT appear anywhere in the file. We assert the key
      // (rendered as `\`move.specific\``) is absent rather than the id alone
      // because if the renderer ever started emitting claim ids verbatim we
      // would still catch the filter regression.
      expect(claudeMd).toContain("`profile.only`");
      expect(claudeMd).not.toContain("`move.specific`");
      expect(claudeMd).not.toContain("claim-move-specific");

      // Sanity: the §8.3 block IS present (the profile-only claim survived).
      expect(claudeMd).toContain("<!-- vault-claims-profile:start");
      expect(claudeMd).toContain("<!-- vault-claims-profile:end -->");
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-running with the same corpus and the same injected today produces byte-identical CLAUDE.md", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-04-30T12:00:00Z"));
      const vault = await mkTempVault();
      created.push(vault);
      await seedProfile(vault, "profile-x");
      await writeClaimFile(vault, {
        id: "claim-idem",
        key: "profile.idem",
        status: "active",
        confidence: 0.75,
        profile: ["profile-x"],
        move: [],
        evidence: ["[[journal-idem]]"],
        last_validated: "2026-04-30",
      });
      await writeClaimsIndex(vault, await buildClaimsIndex(vault));

      const repo = await mkRepoUnder(vault, "tmp-repo-3");
      const today = new Date("2026-04-30T12:00:00Z");

      await bootstrapRepoTool.handler(
        {
          repo_path: repo,
          wiki: "_agents",
          pokemon: "profile-x",
          mcp_server_name: "vault",
        },
        { vaultPath: vault, today, rawConfig: {} } as any,
      );
      const a = await fs.readFile(path.join(repo, "CLAUDE.md"), "utf8");

      await bootstrapRepoTool.handler(
        {
          repo_path: repo,
          wiki: "_agents",
          pokemon: "profile-x",
          mcp_server_name: "vault",
        },
        { vaultPath: vault, today, rawConfig: {} } as any,
      );
      const b = await fs.readFile(path.join(repo, "CLAUDE.md"), "utf8");

      // Acceptance criterion 3: byte-identical (no stripDates needed because
      // we inject the same `today` to both calls — every date-bearing field
      // resolves to the same string, including the staleness-footer
      // render-date and the marker's `rendered:`).
      expect(b).toBe(a);
    } finally {
      vi.useRealTimers();
    }
  });

  it("omits the vault-claims-profile section entirely when no pokemon is supplied", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-04-30T12:00:00Z"));
      const vault = await mkTempVault();
      created.push(vault);
      // Seed a profile-only claim for some profile so the sidecar isn't
      // empty — proves the omission is driven by the absent `pokemon` arg,
      // not by an empty claims store.
      await seedProfile(vault, "profile-x");
      await writeClaimFile(vault, {
        id: "claim-orphan",
        key: "profile.orphan",
        status: "active",
        confidence: 0.8,
        profile: ["profile-x"],
        move: [],
        evidence: ["[[journal-orphan]]"],
        last_validated: "2026-04-30",
      });
      await writeClaimsIndex(vault, await buildClaimsIndex(vault));

      const repo = await mkRepoUnder(vault, "tmp-repo-4");
      // Note: NO `pokemon` field. The handler's profile branch (bootstrap-
      // repo.ts:206-227) is skipped entirely, and `buildClaudeMdFragment`'s
      // profile branch (line 96) never runs — so `renderProfileLearnedSection`
      // is never called.
      await bootstrapRepoTool.handler(
        {
          repo_path: repo,
          wiki: "_agents",
          mcp_server_name: "vault",
        },
        {
          vaultPath: vault,
          today: new Date("2026-04-30T12:00:00Z"),
          rawConfig: {},
        } as any,
      );

      const claudeMd = await fs.readFile(path.join(repo, "CLAUDE.md"), "utf8");

      // The v1.5 bootstrap block IS present (every bootstrap-repo call
      // writes it), but the §8.3 markers are NOT.
      expect(claudeMd).toContain("<!-- vault-mcp v1.5 bootstrap:start -->");
      expect(claudeMd).toContain("<!-- /vault-mcp-bootstrap -->");
      expect(claudeMd).not.toContain("vault-claims-profile");
      expect(claudeMd).not.toContain("## Learned (this profile)");
    } finally {
      vi.useRealTimers();
    }
  });

  it("omits the vault-claims-profile section when the deploying profile has zero qualifying profile-only claims", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-04-30T12:00:00Z"));
      const vault = await mkTempVault();
      created.push(vault);
      await seedProfile(vault, "profile-x");

      // Only a move-specific claim exists for profile-x — the §8.3 filter
      // drops it, leaving zero qualifying claims. The renderer at
      // bootstrap-repo.ts:45 returns null on zero, and the caller (line 109)
      // skips the marker push entirely.
      await writeClaimFile(vault, {
        id: "claim-mv-only",
        key: "move.mv",
        status: "active",
        confidence: 0.9,
        profile: ["profile-x"],
        move: ["move-x"],
        evidence: ["[[journal-mv]]"],
        last_validated: "2026-04-30",
      });
      await writeClaimsIndex(vault, await buildClaimsIndex(vault));

      const repo = await mkRepoUnder(vault, "tmp-repo-5");
      await bootstrapRepoTool.handler(
        {
          repo_path: repo,
          wiki: "_agents",
          pokemon: "profile-x",
          mcp_server_name: "vault",
        },
        {
          vaultPath: vault,
          today: new Date("2026-04-30T12:00:00Z"),
          rawConfig: {},
        } as any,
      );

      const claudeMd = await fs.readFile(path.join(repo, "CLAUDE.md"), "utf8");

      // The v1.5 block exists; the §8.3 sub-block does not. The profile-
      // operating heading IS still present (that's part of the v1.5 block,
      // not the §8.3 sub-block).
      expect(claudeMd).toContain("<!-- vault-mcp v1.5 bootstrap:start -->");
      expect(claudeMd).toContain("Operating as");
      expect(claudeMd).not.toContain("vault-claims-profile");
      expect(claudeMd).not.toContain("## Learned (this profile)");
      expect(claudeMd).not.toMatch(/more than 30 days old/);
    } finally {
      vi.useRealTimers();
    }
  });
});
