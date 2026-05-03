// vault-mcp/tests/integration/lint-claims-registration.test.ts
//
// Plan 1 §task-lint-checks-registration. Integration test asserting that
// invoking `vault.lint` over a vault containing intentionally-broken claim
// files emits diagnostics from all six new claim lint rules:
//
//   Group A (registered in their own files via registerLintCheck):
//     - CLAIM_KEY_COLLISION
//     - CLAIM_EFFECTIVE_BELOW_FLOOR
//     - CLAIM_TAG_REPO_PREFIX_MALFORMED
//
//   Group B (defined as `{id, severity, appliesTo, check}` per the plan
//   template; bridged into the registry by `core/lint-checks/registration.ts`):
//     - CLAIM_WITHOUT_EVIDENCE
//     - CLAIM_WITH_NO_SCOPE
//     - CLAIM_SUPERSEDED_WITHOUT_SUPERSEDOR
//
// The harness builds a fixture vault on disk (claim files under
// `wikis/_agents/claim/`, plus `_index/deployments.json` so the repo-prefix
// rule does not short-circuit), reindexes it, then invokes `lintTool.handler`
// directly. Each assertion targets ONE rule and checks ≥1 diagnostic with the
// expected code. If the registration adapter is removed or any single rule
// stops firing, the corresponding assertion fails.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reindex } from "../../src/core/reindex.js";
import { lintTool } from "../../src/tools/lint.js";

let vault: string;

function writeMap(wiki: string) {
  writeFileSync(join(vault, "wikis", wiki, "map.md"), `---
id: map-${wiki}
title: ${wiki}
type: map
wiki: ${wiki}
status: active
created: 2026-04-30
updated: 2026-04-30
summary: m
---
m
`);
}

interface ClaimSpec {
  id: string;
  status?: "active" | "superseded" | "retracted" | "draft";
  key?: string;
  confidence?: number;
  last_validated?: string;
  profile?: string[];
  move?: string[];
  scope_wiki?: string[];
  tags?: string[];
  evidence?: string[];
  superseded_by?: string | null;
  authored_by?: string;
}

function writeClaim(wiki: string, c: ClaimSpec) {
  const dir = join(vault, "wikis", wiki, "claim");
  mkdirSync(dir, { recursive: true });
  const fm: Record<string, unknown> = {
    id: c.id,
    type: "claim",
    title: c.id,
    created: "2026-05-02",
    key: c.key ?? "test.x",
    status: c.status ?? "active",
    confidence: c.confidence ?? 0.7,
    last_validated: c.last_validated ?? "2026-05-02",
    profile: c.profile ?? [],
    move: c.move ?? [],
    scope_wiki: c.scope_wiki ?? [],
    tags: c.tags ?? [],
    evidence: c.evidence ?? ["[[wikis/_agents/journal/journal-x]]"],
    authored_by: c.authored_by ?? "agent:test",
    superseded_by: c.superseded_by ?? null,
    wiki,
  };
  const yaml = Object.entries(fm)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");
  writeFileSync(join(dir, `${c.id}.md`), `---\n${yaml}\n---\n\nbody\n`);
}

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-lint-claims-reg-"));
  mkdirSync(join(vault, "wikis", "_agents", "claim"), { recursive: true });
  mkdirSync(join(vault, "_index"), { recursive: true });
  writeMap("_agents");
  // Empty deployments registry so CLAIM_TAG_REPO_PREFIX_MALFORMED does NOT
  // short-circuit. We feed a known repo "vault-mcp" so the malformed-prefix
  // case (bare "repo:" tag) triggers without the unknown-repo case.
  writeFileSync(
    join(vault, "_index", "deployments.json"),
    JSON.stringify([{ repo: "vault-mcp" }], null, 2),
  );
});

afterEach(() => {
  if (vault) rmSync(vault, { recursive: true, force: true });
});

async function runLint() {
  await reindex(vault);
  return await lintTool.handler(
    { wiki: "_agents", level: "info" },
    { vaultPath: vault },
  );
}

describe("vault.lint — claim rule registration (all 6 rules fire)", () => {
  it("emits CLAIM_WITHOUT_EVIDENCE for an active claim with empty evidence", async () => {
    writeClaim("_agents", {
      id: "claim-no-evidence",
      key: "alpha.no-evidence",
      profile: ["p"],
      evidence: [],
    });
    const result = await runLint();
    const hits = result.diagnostics.filter(d => d.code === "CLAIM_WITHOUT_EVIDENCE");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].page_id).toBe("claim-no-evidence");
  });

  it("emits CLAIM_WITH_NO_SCOPE for an active claim with all scope dimensions empty", async () => {
    writeClaim("_agents", {
      id: "claim-no-scope",
      key: "alpha.no-scope",
      // profile/move/scope_wiki/tags all empty (defaults)
    });
    const result = await runLint();
    const hits = result.diagnostics.filter(d => d.code === "CLAIM_WITH_NO_SCOPE");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].page_id).toBe("claim-no-scope");
  });

  it("emits CLAIM_SUPERSEDED_WITHOUT_SUPERSEDOR for a superseded claim with null superseded_by", async () => {
    writeClaim("_agents", {
      id: "claim-dangling",
      key: "alpha.dangling",
      status: "superseded",
      profile: ["p"],
      superseded_by: null,
    });
    const result = await runLint();
    const hits = result.diagnostics.filter(d => d.code === "CLAIM_SUPERSEDED_WITHOUT_SUPERSEDOR");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].page_id).toBe("claim-dangling");
    expect(hits[0].severity).toBe("error");
  });

  it("emits CLAIM_KEY_COLLISION for two active claims sharing identity tuple", async () => {
    writeClaim("_agents", { id: "claim-collide-a", key: "shared.key", profile: ["p"] });
    writeClaim("_agents", { id: "claim-collide-b", key: "shared.key", profile: ["p"] });
    const result = await runLint();
    const hits = result.diagnostics.filter(d => d.code === "CLAIM_KEY_COLLISION");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].message).toContain("claim-collide-a");
    expect(hits[0].message).toContain("claim-collide-b");
  });

  it("emits CLAIM_EFFECTIVE_BELOW_FLOOR for an active claim whose decayed confidence dropped below render floor", async () => {
    // Stored confidence 0.45, last_validated 4 years ago — half_life=180d (default)
    // → effective ≈ 0.45 * 0.5^(1460/180) ≈ tiny, well below render_min_confidence=0.4.
    writeClaim("_agents", {
      id: "claim-decayed",
      key: "alpha.decayed",
      profile: ["p"],
      confidence: 0.45,
      last_validated: "2022-05-02",
    });
    const result = await runLint();
    const hits = result.diagnostics.filter(d => d.code === "CLAIM_EFFECTIVE_BELOW_FLOOR");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.some(h => h.page_id === "claim-decayed")).toBe(true);
  });

  it("emits CLAIM_TAG_REPO_PREFIX_MALFORMED for a claim with bare 'repo:' tag", async () => {
    writeClaim("_agents", {
      id: "claim-bad-repo-tag",
      key: "alpha.bad-tag",
      profile: ["p"],
      tags: ["repo:"],  // empty value after prefix → malformed
    });
    const result = await runLint();
    const hits = result.diagnostics.filter(d => d.code === "CLAIM_TAG_REPO_PREFIX_MALFORMED");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].page_id).toBe("claim-bad-repo-tag");
  });

  it("a single combined fixture surfaces all six codes in one lint run", async () => {
    writeClaim("_agents", { id: "c-no-evi", key: "k.evi", profile: ["p"], evidence: [] });
    writeClaim("_agents", { id: "c-no-scope", key: "k.scope" });
    writeClaim("_agents", {
      id: "c-dangling", key: "k.dang", status: "superseded", profile: ["p"], superseded_by: null,
    });
    writeClaim("_agents", { id: "c-coll-a", key: "k.coll", profile: ["px"] });
    writeClaim("_agents", { id: "c-coll-b", key: "k.coll", profile: ["px"] });
    writeClaim("_agents", {
      id: "c-decay", key: "k.dec", profile: ["p"],
      confidence: 0.45, last_validated: "2022-05-02",
    });
    writeClaim("_agents", { id: "c-bad-tag", key: "k.tag", profile: ["p"], tags: ["repo:"] });

    const result = await runLint();
    const codes = new Set(result.diagnostics.map(d => d.code));
    expect(codes.has("CLAIM_WITHOUT_EVIDENCE")).toBe(true);
    expect(codes.has("CLAIM_WITH_NO_SCOPE")).toBe(true);
    expect(codes.has("CLAIM_SUPERSEDED_WITHOUT_SUPERSEDOR")).toBe(true);
    expect(codes.has("CLAIM_KEY_COLLISION")).toBe(true);
    expect(codes.has("CLAIM_EFFECTIVE_BELOW_FLOOR")).toBe(true);
    expect(codes.has("CLAIM_TAG_REPO_PREFIX_MALFORMED")).toBe(true);
  });
});
