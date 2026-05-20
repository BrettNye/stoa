// vault-mcp/tests/integration/synthesize-by-agent-claims.test.ts
//
// task-synthesize-integration-test (Plan 2 Wave 4) — end-to-end idempotency
// test for `vault_synthesize` in the by-agent / memory scope. Verifies that
// two consecutive runs on the same date and corpus produce byte-identical
// output (modulo render-date), that the Learnings section appears with the
// expected shape and placement (after `## Inputs cited`, between
// `vault-claims-synthesis` markers), and that toggling claims (retracting
// every claim) removes the section as expected.
//
// Driven through the registered MCP tool dispatcher (`callTool` resolves
// against `allTools` in src/tools/index.ts), so the full tool path is
// exercised — including the synthesize tool's mkdirSync workaround for
// fresh-vault ENOENT. The retraction test additionally rebuilds the claims
// sidecar via `buildClaimsIndex` + `writeClaimsIndex` to cover the
// disk-rewrite path.
//
// Drift notes (vs. the Plan 2 §task-synthesize-integration-test reference
// snippet, lines 1064-1138):
//   - Synthesis output filename is `synthesis-<by_agent>-memory.md` where
//     `<by_agent>` is the FULL profile id (e.g. `profile-x` →
//     `synthesis-profile-x-memory.md`). The plan snippet's
//     `synthesis-x-memory.md` was wrong; see `core/synthesize.ts` line 36.
//   - `callTool` does NOT run Zod input parsing, so we pass fully-defaulted
//     inputs: `{ topic, scope: "memory", by_agent }` — `topic` is required
//     and `scope` defaults to `"topic"` (which would write to the wrong
//     path). This matches the unit test sibling at
//     tests/unit/synthesize-by-agent.test.ts.
//   - The "modulo render-date" strip function uses the working capture-group
//     pattern from d9b4933 (NOT the broken no-op the plan snippet showed for
//     a brief window) so that frontmatter `created`/`updated`/`last_compiled`
//     and the `_Compiled <date>` prose line are normalized too. Same stripper
//     as the unit-test sibling, kept in sync deliberately.
//
// Hermetic: every test runs against an `mkTempVault` under `os.tmpdir()`;
// nothing reads or writes the live vault root.

import { describe, it, expect, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import { rmSync } from "node:fs";
import path from "node:path";
import { mkTempVault, writeClaimFile, callTool } from "../helpers.js";
import { buildClaimsIndex, writeClaimsIndex } from "../../src/core/claims-index.js";

/**
 * Compute the synthesis output path for a given profile id. Mirrors the
 * computation in `src/tools/synthesize.ts:synthesisOutputPath` and
 * `src/core/synthesize.ts` (scope=memory branch). Kept local so the test
 * fails loudly if the tool's path convention drifts.
 */
function synthPath(vault: string, byAgent: string): string {
  return path.join(
    vault,
    "wikis",
    "_agents",
    "synthesis",
    `synthesis-${byAgent}-memory.md`,
  );
}

/**
 * Seed a temp vault with a profile stub plus N active claims tagged
 * `windows` and attributed to `profileId`. Builds and writes the claims
 * sidecar so `loadActiveProfileClaims` finds them via the sidecar fast-path.
 */
async function seedSynthesizeFixture(
  vault: string,
  profileId: string,
  claimCount: number,
): Promise<void> {
  const profileDir = path.join(vault, "wikis", "_agents", "profiles");
  await fs.mkdir(profileDir, { recursive: true });
  await fs.writeFile(
    path.join(profileDir, `${profileId}.md`),
    `---\nid: ${profileId}\ntype: profile\nwiki: _agents\n---\n`,
  );

  for (let i = 0; i < claimCount; i++) {
    await writeClaimFile(vault, {
      id: `claim-w${i}`,
      key: `windows.${i}`,
      status: "active",
      confidence: 0.8,
      profile: [profileId],
      tags: ["windows"],
      evidence: [`[[journal-${i}]]`],
      last_validated: "2026-05-01",
    });
  }
  await writeClaimsIndex(vault, await buildClaimsIndex(vault));
}

/**
 * Strip every emitted date so two synthesize runs across a UTC midnight
 * boundary (or two synthesize runs at deliberately different fake-timer
 * dates — see the "different-date re-runs" test) still compare equal.
 * Identical pattern to the unit-test sibling (kept in sync deliberately so
 * a regression to no-op stripping fails both suites at once). Covers:
 *   - marker-line `rendered: <date>`
 *   - frontmatter `created` / `updated` / `last_compiled` — the gray-matter
 *     YAML serializer wraps these in single quotes (`created: '2026-04-01'`)
 *     because they parse as YAML date scalars; the regex matches optional
 *     wrapping quote so both quoted and unquoted serializations normalize.
 *   - prose `_Compiled <date>` line in the body
 */
function stripDates(s: string): string {
  return s
    .replace(/rendered: \d{4}-\d{2}-\d{2}/g, "rendered: <DATE>")
    .replace(
      /((?:^|\n)(?:created|updated|last_compiled): )'?\d{4}-\d{2}-\d{2}'?/g,
      "$1<DATE>",
    )
    .replace(/_Compiled \d{4}-\d{2}-\d{2}/g, "_Compiled <DATE>");
}

describe("vault_synthesize --by-agent claims integration", () => {
  // Track temp vaults for cleanup so a failing test doesn't leak temp dirs.
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

  it("self-tests stripDates so a regression to no-op behaviour is caught here, not in a flaky equality assertion downstream", () => {
    expect(stripDates("rendered: 2026-05-03")).toBe("rendered: <DATE>");
    expect(stripDates("created: 2026-05-03")).toBe("created: <DATE>");
    expect(stripDates("updated: 2026-05-03")).toBe("updated: <DATE>");
    expect(stripDates("last_compiled: 2026-05-03")).toBe("last_compiled: <DATE>");
    expect(stripDates("_Compiled 2026-05-03")).toBe("_Compiled <DATE>");
    // gray-matter wraps frontmatter dates in single quotes; the stripper
    // handles both quoted and unquoted serializations.
    expect(stripDates("created: '2026-05-03'")).toBe("created: <DATE>");
    expect(stripDates("updated: '2026-05-03'")).toBe("updated: <DATE>");
    expect(stripDates("last_compiled: '2026-05-03'")).toBe("last_compiled: <DATE>");
    // Idempotent: stripping twice is a fixed point.
    expect(stripDates(stripDates("last_compiled: 2026-05-03"))).toBe(
      "last_compiled: <DATE>",
    );
    expect(stripDates(stripDates("last_compiled: '2026-05-03'"))).toBe(
      "last_compiled: <DATE>",
    );
  });

  it("emits a Learnings section between vault-claims-synthesis markers, placed after ## Inputs cited", async () => {
    const vault = await mkTempVault();
    created.push(vault);
    await seedSynthesizeFixture(vault, "profile-x", 5);

    await callTool(
      "vault_synthesize",
      { topic: "anything", scope: "memory", by_agent: "profile-x" },
      vault,
    );

    const out = await fs.readFile(synthPath(vault, "profile-x"), "utf8");

    // Markers and the Learnings heading are both present.
    expect(out).toContain("<!-- vault-claims-synthesis:start");
    expect(out).toContain("<!-- vault-claims-synthesis:end -->");
    expect(out).toContain("## Learnings");
    // Exact bucket header per spec §8.5: "### <tag> (N claims)".
    expect(out).toContain("### windows (5 claims)");

    // Inputs cited section is preserved (core/synthesize.ts writes it).
    expect(out).toContain("## Inputs cited");

    // Placement: Learnings appears AFTER Inputs cited (spec §8.5 step 4).
    const inputsIdx = out.indexOf("## Inputs cited");
    const learningsIdx = out.indexOf("## Learnings");
    expect(inputsIdx).toBeGreaterThan(0);
    expect(learningsIdx).toBeGreaterThan(inputsIdx);

    // Markers also bracket the Learnings heading.
    const startIdx = out.indexOf("<!-- vault-claims-synthesis:start");
    const endIdx = out.indexOf("<!-- vault-claims-synthesis:end -->");
    expect(startIdx).toBeGreaterThan(0);
    expect(endIdx).toBeGreaterThan(startIdx);
    expect(learningsIdx).toBeGreaterThan(startIdx);
    expect(learningsIdx).toBeLessThan(endIdx);
  });

  it("re-running on unchanged corpus produces byte-identical output (modulo render-date)", async () => {
    const vault = await mkTempVault();
    created.push(vault);
    await seedSynthesizeFixture(vault, "profile-x", 5);

    await callTool(
      "vault_synthesize",
      { topic: "anything", scope: "memory", by_agent: "profile-x" },
      vault,
    );
    const a = await fs.readFile(synthPath(vault, "profile-x"), "utf8");

    await callTool(
      "vault_synthesize",
      { topic: "anything", scope: "memory", by_agent: "profile-x" },
      vault,
    );
    const b = await fs.readFile(synthPath(vault, "profile-x"), "utf8");

    // Modulo every emitted date — covers same-date runs (b === a, strip is
    // a no-op) and runs that straddle a UTC midnight boundary (strip
    // normalizes both sides to <DATE>).
    expect(stripDates(b)).toBe(stripDates(a));
  });

  it("different-date re-runs differ ONLY in timestamp fields (rendered/created/updated/last_compiled/_Compiled)", async () => {
    // Spec acceptance criterion (Plan 2 §task-synthesize-integration-test):
    // "Two consecutive synthesize runs on an unchanged corpus on different
    // dates produce output that differs ONLY in the `rendered: YYYY-MM-DD`
    // clause inside the start marker."
    //
    // SPEC-VS-IMPLEMENTATION DRIFT (loose-interpretation note, resolution (a)
    // from the task brief): the spec says "ONLY rendered:" but the actual
    // implementation stamps five timestamp fields from the same `today`:
    //   - frontmatter `created` / `updated` / `last_compiled` (core/synthesize.ts:71-77)
    //   - prose `_Compiled <date>` line (core/synthesize.ts:84)
    //   - marker-line `rendered: <date>` (tools/synthesize.ts:152)
    // All five advance together when the system clock advances. We mask all
    // five via `stripDates` and treat "modulo all timestamps" as the loose
    // intent. If the tool ever stamps a NEW date-bearing field, this test
    // will fail (because `stripDates` won't normalize it) — that failure is
    // the signal to either extend `stripDates` or revisit the spec.
    //
    // SECOND DRIFT (decay-aware test design, NOT a stripper concern):
    // `tools/synthesize.ts:196` renders `effectiveConfidence(claim, today)`
    // which applies time-based decay (decay.ts:42, half_life_days=75). With
    // `last_validated: 2026-05-01` and run dates straddling that anchor, the
    // displayed confidence (`eff.toFixed(2)`) drifts between runs — e.g.
    // day0=0.80, day14=0.73 — and that IS substantive content, NOT a
    // timestamp. To prove the date-plumbing path while keeping the
    // assertion honest, we pick two run dates that are BOTH STRICTLY BEFORE
    // the fixture's `last_validated`. `decay.ts:calendarDays` clamps the
    // delta with `Math.max(0, ...)`, so any date <= last_validated yields
    // 0 days of decay → identical displayed confidence on both runs. This
    // is the seam that lets us advance the clock without polluting the
    // substantive output.
    //
    // MECHANISM: vi.useFakeTimers() + vi.setSystemTime() patches the global
    // Date constructor, so both core/synthesize.ts:46 (`new Date()`) and
    // tools/synthesize.ts:68 (`new Date()` passed into the claims pipeline
    // for decay) see the patched clock. claim-clustering.ts injects `today`
    // through every call path and never reads `Date.now()` itself
    // (claim-clustering.ts:16-17), so a single setSystemTime call suffices.
    vi.useFakeTimers();
    try {
      // Both run dates are strictly < `last_validated: 2026-05-01` from the
      // fixture, so decay clamps to 0 on both runs. See the SECOND DRIFT
      // note above.
      vi.setSystemTime(new Date("2026-04-01T12:00:00Z"));
      const vault = await mkTempVault();
      created.push(vault);
      await seedSynthesizeFixture(vault, "profile-x", 5);

      await callTool(
        "vault_synthesize",
        { topic: "anything", scope: "memory", by_agent: "profile-x" },
        vault,
      );
      const day1 = await fs.readFile(synthPath(vault, "profile-x"), "utf8");
      // Sanity: day1 was written with the April 1 stamp.
      expect(day1).toContain("rendered: 2026-04-01");

      vi.setSystemTime(new Date("2026-04-15T12:00:00Z"));
      await callTool(
        "vault_synthesize",
        { topic: "anything", scope: "memory", by_agent: "profile-x" },
        vault,
      );
      const day2 = await fs.readFile(synthPath(vault, "profile-x"), "utf8");
      // Sanity: day2 actually advanced (otherwise the assertion below would
      // be vacuously true even with a broken stripper).
      expect(day2).toContain("rendered: 2026-04-15");

      // The substantive content is identical once timestamp fields are
      // normalized. If anything OTHER than the five known timestamp fields
      // diverges between the two dates, this assertion catches it.
      expect(stripDates(day2)).toBe(stripDates(day1));
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves Inputs cited and other hand-written prose byte-for-byte across re-runs", async () => {
    // Acceptance criterion: "The pre-existing `## Inputs cited` section (and
    // any other hand-written prose) is preserved byte-for-byte across all
    // transitions." We verify this by capturing the substring from the page
    // start through the `vault-claims-synthesis:start` marker (the prefix
    // the marker block does NOT touch) and asserting it is identical across
    // two runs (modulo the date stripper).
    const vault = await mkTempVault();
    created.push(vault);
    await seedSynthesizeFixture(vault, "profile-x", 5);

    await callTool(
      "vault_synthesize",
      { topic: "anything", scope: "memory", by_agent: "profile-x" },
      vault,
    );
    const a = await fs.readFile(synthPath(vault, "profile-x"), "utf8");

    await callTool(
      "vault_synthesize",
      { topic: "anything", scope: "memory", by_agent: "profile-x" },
      vault,
    );
    const b = await fs.readFile(synthPath(vault, "profile-x"), "utf8");

    const prefix = (s: string) => {
      const idx = s.indexOf("<!-- vault-claims-synthesis:start");
      if (idx < 0) throw new Error("expected start marker in synthesis output");
      return stripDates(s.slice(0, idx));
    };
    expect(prefix(b)).toBe(prefix(a));
    // Prefix must contain Inputs cited — that's the whole point of the
    // "preserved hand-written prose" assertion.
    expect(prefix(a)).toContain("## Inputs cited");
  });

  it("removes the Learnings section when all claims are retracted on disk and the sidecar rebuilt", async () => {
    const vault = await mkTempVault();
    created.push(vault);
    await seedSynthesizeFixture(vault, "profile-x", 5);

    await callTool(
      "vault_synthesize",
      { topic: "anything", scope: "memory", by_agent: "profile-x" },
      vault,
    );
    const before = await fs.readFile(synthPath(vault, "profile-x"), "utf8");
    expect(before).toContain("vault-claims-synthesis:start");
    expect(before).toContain("## Learnings");

    // Retract every claim by rewriting its frontmatter on disk. The helper
    // writes status/superseded_by as JSON.stringify-quoted values (e.g.
    // `status: "active"`), so the regex matches the helper's serialization
    // exactly. The retraction-frontmatter shape (retracted_at, retracted_by,
    // retraction_reason) matches what `core/claims.ts` ClaimFrontmatter
    // accepts.
    const claimDir = path.join(vault, "wikis", "_agents", "claim");
    for (const f of await fs.readdir(claimDir)) {
      if (!f.endsWith(".md")) continue;
      const p = path.join(claimDir, f);
      let raw = await fs.readFile(p, "utf8");
      raw = raw.replace(/status: "active"/, 'status: "retracted"');
      raw = raw.replace(
        /superseded_by: null/,
        'superseded_by: null\nretracted_at: "2026-05-03"\nretracted_by: "agent:test"\nretraction_reason: "test"',
      );
      await fs.writeFile(p, raw, "utf8");
    }
    // Rebuild the sidecar: buildClaimsIndex skips non-active claims, so
    // by_profile["profile-x"] will be absent (or empty) after the rebuild.
    await writeClaimsIndex(vault, await buildClaimsIndex(vault));

    await callTool(
      "vault_synthesize",
      { topic: "anything", scope: "memory", by_agent: "profile-x" },
      vault,
    );
    const after = await fs.readFile(synthPath(vault, "profile-x"), "utf8");

    // Whole marker block is gone.
    expect(after).not.toContain("vault-claims-synthesis:start");
    expect(after).not.toContain("vault-claims-synthesis:end");
    expect(after).not.toContain("## Learnings");
    expect(after).not.toContain("### windows");

    // Inputs cited (from core/synthesize) survives the cleanup pass.
    expect(after).toContain("## Inputs cited");
  });
});
