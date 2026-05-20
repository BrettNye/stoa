// vault-mcp/tests/integration/claim-roundtrip.test.ts
//
// Plan 1 §task-integration-roundtrip — the join-point integration test.
//
// Exercises the full Plan 1 surface end-to-end through the registered tool
// dispatcher (`callTool` resolves against `allTools` in src/tools/index.ts):
//
//   create  → reindex → list
//   supersede → reindex → list (active vs superseded buckets)
//   revalidate
//   retract → reindex → list (default excludes retracted)
//   inspect _index/claims.json shape
//   lint over a fixture corpus with all 6 claim-rule violations
//
// The roundtrip and the lint corpus run in separate temp vaults: the
// roundtrip vault must end clean (no claim-rule diagnostics), the lint
// corpus must end dirty in exactly six ways. Folding both into one vault
// would have the supersession trail collide with the dangling-supersedor
// fixture, and would force the roundtrip's clean-corpus assertion to
// special-case rule codes coming out of the deliberate violations.
//
// Diagnostic-shape note: the plan template (1817-1902) referenced
// `lint.findings.filter(f => f.ruleId.startsWith("claim-"))`. The
// implemented vault_lint surface returns `diagnostics: Diagnostic[]` with
// `code: string` in UPPER_SNAKE form — see src/core/lint.ts §LintResult
// and src/core/lint-checks/registration.ts §ruleIdToCode. This test is
// written against the implemented shape.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callTool, mkTempVault } from "../helpers.js";

interface SidecarShape {
  by_profile: Record<string, string[]>;
  by_move: Record<string, string[]>;
  by_scope_wiki: Record<string, string[]>;
  by_tag: Record<string, string[]>;
  global: string[];
  generated_at: string;
  schema_version: number;
}

async function readClaimsSidecar(vault: string): Promise<SidecarShape> {
  const raw = await fs.readFile(join(vault, "_index", "claims.json"), "utf8");
  return JSON.parse(raw) as SidecarShape;
}

function writeMap(vault: string, wiki: string): void {
  writeFileSync(
    join(vault, "wikis", wiki, "map.md"),
    `---
id: map-${wiki}
title: ${wiki}
type: map
wiki: ${wiki}
status: active
created: 2026-05-02
updated: 2026-05-02
summary: m
---
m
`,
  );
}

describe("claim flow roundtrip — Plan 1 join point", () => {
  let vault: string;

  beforeEach(async () => {
    vault = await mkTempVault();
    writeMap(vault, "_agents");
  });

  afterEach(() => {
    if (vault) rmSync(vault, { recursive: true, force: true });
  });

  it("creates → reindexes → lists → supersedes → revalidates → retracts → asserts clean lint", async () => {
    // ── step 1: empty vault → vault_claim creates a draft ─────────────────
    const created = await callTool(
      "vault_claim",
      {
        key: "test.preflight",
        title: "preflight required",
        body: "On Windows worktrees, verify git remote -v before push.",
        tags: ["windows"],
        evidence: ["[[wikis/_agents/journal/journal-preflight]]"],
        confidence: 0.7,
        as: "agent:test",
      },
      vault,
    );
    expect(created.action).toBe("created");
    expect(created.reindex_recommended).toBe(true);
    expect(typeof created.claim_id).toBe("string");

    // The created file actually lives on disk under wikis/_agents/claim/.
    const createdPath = join(vault, "wikis", "_agents", "claim", `${created.claim_id}.md`);
    const stat = await fs.stat(createdPath);
    expect(stat.isFile()).toBe(true);

    // ── step 2: vault_reindex builds the claims sidecar ───────────────────
    await callTool("vault_reindex", {}, vault);
    const sidecar1 = await readClaimsSidecar(vault);
    expect(sidecar1.schema_version).toBe(3);
    // Default scoping (§6.6): profile defaulted to [`as`], with `agent:` /
    // `profile-` prefixes stripped to match what `vault_agent-memory`
    // normalizes its query input to. So the sidecar bucket is keyed by the
    // bare name "test", not "agent:test".
    expect(sidecar1.by_profile["test"]).toEqual([created.claim_id]);
    expect(sidecar1.by_tag["windows"]).toEqual([created.claim_id]);
    expect(sidecar1.global).toEqual([]);

    // ── step 3: vault_list-claims returns the new claim by profile ────────
    // `value` matches the stored bare-name profile (see prefix-strip note above).
    // `status: ["active"]` is the schema default; the test helper invokes the
    // handler directly without re-parsing through Zod, so the default is not
    // applied for us — pass it explicitly here and below.
    const listed = await callTool(
      "vault_list-claims",
      { by: "profile", value: "test", status: ["active"] },
      vault,
    );
    expect(listed.claims).toHaveLength(1);
    expect(listed.claims[0].id).toBe(created.claim_id);
    expect(listed.total).toBe(1);

    // ── step 4: supersede with higher confidence ──────────────────────────
    const superseded = await callTool(
      "vault_claim",
      {
        key: "test.preflight",
        title: "preflight required (revised)",
        body: "Always verify origin before push, not just on Windows.",
        tags: ["windows"], // identical scope_hash → same identity tuple
        evidence: ["[[wikis/_agents/journal/journal-preflight-rev]]"],
        confidence: 0.9,
        as: "agent:test",
      },
      vault,
    );
    expect(superseded.action).toBe("superseded");
    expect(superseded.superseded_id).toBe(created.claim_id);
    expect(superseded.claim_id).not.toBe(created.claim_id);

    // ── step 5: reindex; old claim no longer in active buckets ────────────
    await callTool("vault_reindex", {}, vault);
    const sidecar2 = await readClaimsSidecar(vault);
    expect(sidecar2.by_profile["test"]).toEqual([superseded.claim_id]);
    expect(sidecar2.by_tag["windows"]).toEqual([superseded.claim_id]);

    const activeNow = await callTool(
      "vault_list-claims",
      { by: "profile", value: "test", status: ["active"] },
      vault,
    );
    expect(activeNow.claims).toHaveLength(1);
    expect(activeNow.claims[0].id).toBe(superseded.claim_id);
    expect(activeNow.claims[0].supersedes).toContain(created.claim_id);

    // ── step 6: list superseded claims explicitly ─────────────────────────
    // Non-active claims always have effective_confidence === 0 (decay.ts:47),
    // and the default render_min_confidence is 0.4 — so listing superseded
    // claims requires explicitly opting under the floor.
    const supList = await callTool(
      "vault_list-claims",
      {
        by: "profile",
        value: "test",
        status: ["superseded"],
        min_effective_confidence: 0,
      },
      vault,
    );
    expect(supList.claims).toHaveLength(1);
    expect(supList.claims[0].id).toBe(created.claim_id);
    expect(supList.claims[0].status).toBe("superseded");
    expect(supList.claims[0].superseded_by).toBe(superseded.claim_id);

    // ── step 7: revalidate the active claim ───────────────────────────────
    const revalidated = await callTool(
      "vault_claim",
      {
        key: "test.preflight",
        title: "preflight required (revised)",
        body: "Always verify origin before push, not just on Windows.",
        tags: ["windows"],
        evidence: ["[[wikis/_agents/journal/journal-preflight-rev]]"],
        confidence: 0.9,
        as: "agent:test",
        revalidate: true,
      },
      vault,
    );
    expect(revalidated.action).toBe("revalidated");
    expect(revalidated.claim_id).toBe(superseded.claim_id);

    // ── step 8: retract ───────────────────────────────────────────────────
    const retracted = await callTool(
      "vault_claim",
      {
        retract: revalidated.claim_id,
        reason:
          "Decision was wrong; preflight is automatic in newer git versions.",
        as: "agent:test",
      },
      vault,
    );
    expect(retracted.action).toBe("retracted");
    expect(retracted.claim_id).toBe(revalidated.claim_id);

    // ── step 9: default list now empty (retracted excluded by default) ────
    await callTool("vault_reindex", {}, vault);
    const sidecar3 = await readClaimsSidecar(vault);
    // Sidecar only buckets active claims; after retraction nothing remains.
    expect(sidecar3.by_profile).toEqual({});
    expect(sidecar3.by_tag).toEqual({});
    expect(sidecar3.global).toEqual([]);
    expect(sidecar3.schema_version).toBe(3);
    expect(typeof sidecar3.generated_at).toBe("string");

    const finalList = await callTool(
      "vault_list-claims",
      { by: "profile", value: "test", status: ["active"] },
      vault,
    );
    expect(finalList.claims).toHaveLength(0);

    // The retracted claim is still on disk and still findable when status
    // filter explicitly opts in (with min_effective_confidence: 0 — see step 6).
    const retractedList = await callTool(
      "vault_list-claims",
      {
        by: "profile",
        value: "test",
        status: ["retracted"],
        min_effective_confidence: 0,
      },
      vault,
    );
    expect(retractedList.claims).toHaveLength(1);
    expect(retractedList.claims[0].id).toBe(retracted.claim_id);
    expect(retractedList.claims[0].status).toBe("retracted");

    // ── step 10: lint a clean corpus surfaces no claim-rule diagnostics ───
    const lint = await callTool(
      "vault_lint",
      { wiki: "_agents", level: "info" },
      vault,
    );
    const claimDiags = lint.diagnostics.filter((d: { code: string }) =>
      d.code.startsWith("CLAIM_"),
    );
    if (claimDiags.length > 0) {
      // Surface the offending diagnostic so a regression names itself.
      throw new Error(
        `expected zero claim-rule diagnostics on the clean roundtrip vault; got: ${JSON.stringify(claimDiags)}`,
      );
    }
    expect(claimDiags).toHaveLength(0);
  });
});

describe("claim flow — lint corpus exercises all 6 rules", () => {
  // Distinct vault from the roundtrip flow so the violations don't pollute
  // the clean-corpus assertion above and vice versa.
  let vault: string;

  function writeClaim(
    wiki: string,
    spec: {
      id: string;
      key: string;
      status?: "active" | "superseded" | "retracted" | "draft";
      confidence?: number;
      last_validated?: string;
      profile?: string[];
      move?: string[];
      scope_wiki?: string[];
      tags?: string[];
      evidence?: string[];
      superseded_by?: string | null;
    },
  ): void {
    const dir = join(vault, "wikis", wiki, "claim");
    mkdirSync(dir, { recursive: true });
    const fm: Record<string, unknown> = {
      id: spec.id,
      type: "claim",
      title: spec.id,
      created: "2026-05-02",
      key: spec.key,
      status: spec.status ?? "active",
      confidence: spec.confidence ?? 0.7,
      last_validated: spec.last_validated ?? "2026-05-02",
      profile: spec.profile ?? [],
      move: spec.move ?? [],
      scope_wiki: spec.scope_wiki ?? [],
      tags: spec.tags ?? [],
      evidence: spec.evidence ?? ["[[wikis/_agents/journal/journal-x]]"],
      authored_by: "agent:test",
      superseded_by: spec.superseded_by ?? null,
      wiki,
    };
    const yaml = Object.entries(fm)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join("\n");
    writeFileSync(join(dir, `${spec.id}.md`), `---\n${yaml}\n---\n\nbody\n`);
  }

  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), "vault-claim-roundtrip-lint-"));
    mkdirSync(join(vault, "wikis", "_agents", "claim"), { recursive: true });
    mkdirSync(join(vault, "_index"), { recursive: true });
    writeMap(vault, "_agents");
    // CLAIM_TAG_REPO_PREFIX_MALFORMED short-circuits when deployments.json is
    // absent — write a minimal registry so the malformed-prefix branch fires
    // on a bare "repo:" tag.
    writeFileSync(
      join(vault, "_index", "deployments.json"),
      JSON.stringify([{ repo: "vault-mcp" }], null, 2),
    );
  });

  afterEach(() => {
    if (vault) rmSync(vault, { recursive: true, force: true });
  });

  it("a single corpus surfaces all six CLAIM_* codes in one vault_lint run", async () => {
    // CLAIM_WITHOUT_EVIDENCE — active, empty evidence
    writeClaim("_agents", {
      id: "claim-no-evi",
      key: "lint.evi",
      profile: ["agent:test"],
      evidence: [],
    });
    // CLAIM_WITH_NO_SCOPE — active, all four scope dimensions empty
    writeClaim("_agents", { id: "claim-no-scope", key: "lint.scope" });
    // CLAIM_SUPERSEDED_WITHOUT_SUPERSEDOR — superseded with null supersedor
    writeClaim("_agents", {
      id: "claim-dangling",
      key: "lint.dang",
      status: "superseded",
      profile: ["agent:test"],
      superseded_by: null,
    });
    // CLAIM_KEY_COLLISION — two active claims sharing identity tuple
    writeClaim("_agents", {
      id: "claim-coll-a",
      key: "lint.coll",
      profile: ["agent:test"],
    });
    writeClaim("_agents", {
      id: "claim-coll-b",
      key: "lint.coll",
      profile: ["agent:test"],
    });
    // CLAIM_EFFECTIVE_BELOW_FLOOR — confidence 0.45 last_validated 4y ago
    writeClaim("_agents", {
      id: "claim-decayed",
      key: "lint.dec",
      profile: ["agent:test"],
      confidence: 0.45,
      last_validated: "2022-05-02",
    });
    // CLAIM_TAG_REPO_PREFIX_MALFORMED — bare "repo:" tag with empty value
    writeClaim("_agents", {
      id: "claim-bad-repo-tag",
      key: "lint.tag",
      profile: ["agent:test"],
      tags: ["repo:"],
    });

    await callTool("vault_reindex", {}, vault);
    const result = await callTool(
      "vault_lint",
      { wiki: "_agents", level: "info" },
      vault,
    );

    const codes = new Set<string>(
      (result.diagnostics as Array<{ code: string }>).map((d) => d.code),
    );
    const expected = [
      "CLAIM_WITHOUT_EVIDENCE",
      "CLAIM_WITH_NO_SCOPE",
      "CLAIM_SUPERSEDED_WITHOUT_SUPERSEDOR",
      "CLAIM_KEY_COLLISION",
      "CLAIM_EFFECTIVE_BELOW_FLOOR",
      "CLAIM_TAG_REPO_PREFIX_MALFORMED",
    ] as const;
    for (const code of expected) {
      if (!codes.has(code)) {
        throw new Error(
          `expected lint code ${code} to fire on the violation corpus; got codes: [${[...codes].sort().join(", ")}]`,
        );
      }
      expect(codes.has(code)).toBe(true);
    }
  });
});
