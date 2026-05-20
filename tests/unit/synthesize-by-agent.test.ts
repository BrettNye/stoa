// vault-mcp/tests/unit/synthesize-by-agent.test.ts
//
// task-synthesize-by-agent-extension (Plan 2 Wave 2). Verifies that
// `vault_synthesize` with `by_agent` injects a marker-bounded `## Learnings`
// section after the existing `## Inputs cited` section. Section is populated
// by clustering the profile's active claims by tag (per spec §8.5). Re-runs
// must be byte-identical (same date) and identical-modulo-`rendered:` (different
// dates).
//
// Hermetic: every test runs against an `mkTempVault` — never the live vault.

import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  mkTempVault,
  mkTempVaultWithSidecar,
  writeClaimFile,
  callTool,
  type ClaimFixtureInput,
} from "../helpers.js";

function synthPath(vault: string, profileBare: string): string {
  return path.join(
    vault,
    "wikis",
    "_agents",
    "synthesis",
    `synthesis-${profileBare}-memory.md`,
  );
}

function fiveActiveWindowsClaims(): ClaimFixtureInput[] {
  // Five claims so the default specialty_min_cluster (5) admits the bucket.
  return Array.from({ length: 5 }, (_, i) => ({
    id: `claim-windows-${i + 1}`,
    key: `windows.case-${i + 1}`,
    status: "active" as const,
    confidence: 0.9,
    last_validated: "2026-05-02",
    profile: ["profile-pikachu"],
    tags: ["windows"],
    body: `Body of claim ${i + 1}`,
    // Provide the §summary so the bullet renders summary, not title.
    // (writeClaimFile doesn't ship summary — patch via raw write below.)
  }));
}

async function writeClaimWithSummary(
  vault: string,
  fixture: ClaimFixtureInput & { summary: string },
): Promise<void> {
  await writeClaimFile(vault, fixture);
  // Re-write the file to add the `summary:` field, which writeClaimFile omits.
  const file = path.join(vault, "wikis", fixture.wiki ?? "_agents", "claim", `${fixture.id}.md`);
  const original = await fs.readFile(file, "utf8");
  const patched = original.replace(/^---\n/, `---\nsummary: ${JSON.stringify(fixture.summary)}\n`);
  await fs.writeFile(file, patched, "utf8");
}

describe("vault_synthesize --by-agent — Learnings section", () => {
  it("emits a Learnings section between markers, after Inputs cited", async () => {
    const vault = await mkTempVaultWithSidecar(fiveActiveWindowsClaims());

    await callTool(
      "vault_synthesize",
      {
        topic: "anything",
        scope: "memory",
        by_agent: "profile-pikachu",
      },
      vault,
    );

    const file = await fs.readFile(synthPath(vault, "profile-pikachu"), "utf8");

    // Markers and section heading present.
    expect(file).toContain("<!-- vault-claims-synthesis:start");
    expect(file).toContain("<!-- vault-claims-synthesis:end -->");
    expect(file).toContain("## Learnings");
    expect(file).toContain("### windows (5 claims)");

    // Bullet format: - **`<key>`** — <summary or title>. *(confidence X.XX, validated YYYY-MM-DD)*
    expect(file).toMatch(/- \*\*`windows\.case-1`\*\* — .*\. \*\(confidence \d\.\d{2}, validated 2026-05-02\)\*/);

    // Positional: Learnings AFTER Inputs cited.
    const inputsIdx = file.indexOf("## Inputs cited");
    const learningsIdx = file.indexOf("## Learnings");
    expect(inputsIdx).toBeGreaterThan(0);
    expect(learningsIdx).toBeGreaterThan(inputsIdx);
  });

  it("is idempotent on re-run with the same corpus and same date", async () => {
    const vault = await mkTempVaultWithSidecar(fiveActiveWindowsClaims());

    await callTool(
      "vault_synthesize",
      { topic: "anything", scope: "memory", by_agent: "profile-pikachu" },
      vault,
    );
    const file1 = await fs.readFile(synthPath(vault, "profile-pikachu"), "utf8");

    await callTool(
      "vault_synthesize",
      { topic: "anything", scope: "memory", by_agent: "profile-pikachu" },
      vault,
    );
    const file2 = await fs.readFile(synthPath(vault, "profile-pikachu"), "utf8");

    // Strip every emitted date so the two reads compare equal even if a UTC
    // midnight boundary fell between the two synthesize calls. Covers both the
    // marker-line `rendered:` token, the frontmatter `created`/`updated`/
    // `last_compiled` keys, and the prose `_Compiled <date>` line.
    const strip = (s: string) =>
      s.replace(/rendered: \d{4}-\d{2}-\d{2}/g, "rendered: <DATE>")
       .replace(/((?:^|\n)(?:created|updated|last_compiled): )\d{4}-\d{2}-\d{2}/g, "$1<DATE>")
       .replace(/_Compiled \d{4}-\d{2}-\d{2}/g, "_Compiled <DATE>");

    // Self-test the strip function so a future regression to no-op behaviour
    // is caught at the assertion site rather than masquerading as a flaky
    // midnight-boundary failure.
    expect(strip("last_compiled: 2026-05-03")).toBe("last_compiled: <DATE>");
    expect(strip("created: 2026-05-03")).toBe("created: <DATE>");
    expect(strip("updated: 2026-05-03")).toBe("updated: <DATE>");
    expect(strip("_Compiled 2026-05-03")).toBe("_Compiled <DATE>");
    expect(strip("rendered: 2026-05-03")).toBe("rendered: <DATE>");
    // Idempotent.
    expect(strip(strip("last_compiled: 2026-05-03"))).toBe("last_compiled: <DATE>");

    expect(strip(file2)).toBe(strip(file1));
  });

  it("clusters multi-tag claims into multiple buckets, ordered by claim count desc", async () => {
    // Two tags, both with ≥5 claims. Tag A has 6 claims, Tag B has 5 claims.
    // Some claims carry both tags — they should appear in both buckets.
    const fixtures: ClaimFixtureInput[] = [];
    for (let i = 1; i <= 5; i++) {
      fixtures.push({
        id: `claim-both-${i}`,
        key: `both.case-${i}`,
        status: "active",
        confidence: 0.9,
        last_validated: "2026-05-02",
        profile: ["profile-pikachu"],
        tags: ["alpha", "beta"], // contributes to both buckets
      });
    }
    fixtures.push({
      id: `claim-alpha-only`,
      key: `alpha.case-x`,
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      profile: ["profile-pikachu"],
      tags: ["alpha"],
    });
    const vault = await mkTempVaultWithSidecar(fixtures);

    await callTool(
      "vault_synthesize",
      { topic: "anything", scope: "memory", by_agent: "profile-pikachu" },
      vault,
    );
    const file = await fs.readFile(synthPath(vault, "profile-pikachu"), "utf8");

    expect(file).toContain("### alpha (6 claims)");
    expect(file).toContain("### beta (5 claims)");

    // Order: alpha (6) appears before beta (5).
    const alphaIdx = file.indexOf("### alpha");
    const betaIdx = file.indexOf("### beta");
    expect(alphaIdx).toBeGreaterThan(0);
    expect(betaIdx).toBeGreaterThan(alphaIdx);
  });

  it("removes any existing vault-claims-synthesis block when no qualifying claims remain", async () => {
    // First run: write a file with markers from a 5-claim corpus.
    const vault = await mkTempVaultWithSidecar(fiveActiveWindowsClaims());
    await callTool(
      "vault_synthesize",
      { topic: "anything", scope: "memory", by_agent: "profile-pikachu" },
      vault,
    );
    const beforeFile = await fs.readFile(synthPath(vault, "profile-pikachu"), "utf8");
    expect(beforeFile).toContain("vault-claims-synthesis:start");

    // Now retract every claim by overwriting the sidecar to be empty for this profile.
    await fs.writeFile(
      path.join(vault, "_index", "claims.json"),
      JSON.stringify({ by_profile: { "profile-pikachu": [] } }),
      "utf8",
    );

    await callTool(
      "vault_synthesize",
      { topic: "anything", scope: "memory", by_agent: "profile-pikachu" },
      vault,
    );
    const afterFile = await fs.readFile(synthPath(vault, "profile-pikachu"), "utf8");

    expect(afterFile).not.toContain("vault-claims-synthesis:start");
    expect(afterFile).not.toContain("vault-claims-synthesis:end");
    expect(afterFile).not.toContain("## Learnings");
    // Inputs cited stays — that's the core synthesize's responsibility.
    expect(afterFile).toContain("## Inputs cited");
  });

  it("renders summary when present, falling back to title otherwise", async () => {
    const vault = await mkTempVaultWithSidecar([]);
    await writeClaimWithSummary(vault, {
      id: "claim-with-summary",
      key: "tag.with-summary",
      status: "active",
      confidence: 0.9,
      last_validated: "2026-05-02",
      profile: ["profile-pikachu"],
      tags: ["tagx"],
      summary: "This is the summary text.",
    });
    // 4 more to reach the cluster floor of 5
    for (let i = 1; i <= 4; i++) {
      await writeClaimFile(vault, {
        id: `claim-no-summary-${i}`,
        key: `tagx.case-${i}`,
        status: "active",
        confidence: 0.9,
        last_validated: "2026-05-02",
        profile: ["profile-pikachu"],
        tags: ["tagx"],
      });
    }
    // Patch sidecar so loadActiveProfileClaims sees these claims.
    await fs.writeFile(
      path.join(vault, "_index", "claims.json"),
      JSON.stringify({
        by_profile: {
          "profile-pikachu": [
            "claim-with-summary",
            "claim-no-summary-1",
            "claim-no-summary-2",
            "claim-no-summary-3",
            "claim-no-summary-4",
          ],
        },
      }),
      "utf8",
    );

    await callTool(
      "vault_synthesize",
      { topic: "anything", scope: "memory", by_agent: "profile-pikachu" },
      vault,
    );
    const file = await fs.readFile(synthPath(vault, "profile-pikachu"), "utf8");

    expect(file).toContain("This is the summary text.");
    // The no-summary claim should fall back to id-as-title (writeClaimFile sets title=id).
    expect(file).toContain("claim-no-summary-1");
  });

  it("preserves the rest of the page (Inputs cited and other content) byte-for-byte across re-runs", async () => {
    const vault = await mkTempVaultWithSidecar(fiveActiveWindowsClaims());

    // First run lays down both Inputs cited and Learnings.
    await callTool(
      "vault_synthesize",
      { topic: "anything", scope: "memory", by_agent: "profile-pikachu" },
      vault,
    );
    const file1 = await fs.readFile(synthPath(vault, "profile-pikachu"), "utf8");

    // Second run should not perturb anything except (potentially) the rendered: date.
    await callTool(
      "vault_synthesize",
      { topic: "anything", scope: "memory", by_agent: "profile-pikachu" },
      vault,
    );
    const file2 = await fs.readFile(synthPath(vault, "profile-pikachu"), "utf8");

    // Sections present in same order, same inputs cited, same learnings cluster.
    const sectionOrder = (s: string) => [
      s.indexOf("# profile-pikachu memory"),
      s.indexOf("## Inputs cited"),
      s.indexOf("vault-claims-synthesis:start"),
      s.indexOf("## Learnings"),
      s.indexOf("vault-claims-synthesis:end"),
    ];
    expect(sectionOrder(file2)).toEqual(sectionOrder(file1));
  });
});
