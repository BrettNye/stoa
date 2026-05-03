// vault-mcp/tests/unit/lint-claim-tag-repo-prefix-malformed.test.ts
//
// Acceptance criteria for the CLAIM_TAG_REPO_PREFIX_MALFORMED lint rule.
// Mirrors the contract spelled out in
// `wikis/_meta/plans/2026-05-02-vault-mcp-claims-plan-1-foundation-dag.md`
// §task-lint-tag-repo-prefix:
//
//  - `tags: [repo:<known>]` — silent (registered repo).
//  - `tags: [repo:<unknown>]` — info diagnostic, message names the unknown repo.
//  - `tags: [<no-prefix>]` — silent.
//  - `tags: [repo:]` — info diagnostic, "empty value" / malformed-prefix message.
//  - Missing `_index/deployments.json` — short-circuit, no diagnostics, no throw.
//
// The rule walks `wikis/<wiki>/claim/*.md` from disk because reindex.ts does
// not (yet) index `claim` as a NoteType — see frontmatter.ts NoteType enum.
// `mkTempVaultWithDeployments` + `writeClaimFile` from `tests/helpers.ts`
// produce both the sidecar and on-disk fixtures the rule consumes. We hit
// the registered LintCheck via `runRegisteredChecks` so the test exercises
// the same wiring path the production lint tool uses.

import { describe, it, expect, beforeAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  mkTempVault,
  mkTempVaultWithDeployments,
  writeClaimFile,
} from "../helpers.js";
import { lintCheckRegistry } from "../../src/core/lint-check.js";
import "../../src/core/lint-checks/claim-tag-repo-prefix-malformed.js";
import { loadIndex } from "../../src/core/index.js";

const RULE_CODE = "CLAIM_TAG_REPO_PREFIX_MALFORMED";

function getCheck() {
  const c = lintCheckRegistry.find((c) => c.code === RULE_CODE);
  if (!c) throw new Error(`${RULE_CODE} not registered`);
  return c;
}

async function runOn(vaultPath: string) {
  const idx = loadIndex(vaultPath);
  return getCheck().run({ vaultPath }, idx, {});
}

describe("claim-tag-repo-prefix-malformed lint rule", () => {
  it("registers with code CLAIM_TAG_REPO_PREFIX_MALFORMED", () => {
    expect(getCheck()).toBeDefined();
    expect(getCheck().code).toBe(RULE_CODE);
  });

  it("does NOT trigger when repo: tag value is registered in deployments.json", async () => {
    const vault = await mkTempVaultWithDeployments([{ repo: "knowledge-vault" }]);
    await writeClaimFile(vault, {
      id: "claim-known-repo",
      key: "test.known",
      status: "active",
      confidence: 0.7,
      tags: ["repo:knowledge-vault"],
    });
    const diags = await runOn(vault);
    expect(diags.filter((d) => d.code === RULE_CODE)).toHaveLength(0);
  });

  it("triggers info when repo: tag value is NOT in deployments.json", async () => {
    const vault = await mkTempVaultWithDeployments([{ repo: "knowledge-vault" }]);
    await writeClaimFile(vault, {
      id: "claim-unknown-repo",
      key: "test.unknown",
      status: "active",
      confidence: 0.7,
      tags: ["repo:totally-other-repo"],
    });
    const diags = await runOn(vault);
    const hits = diags.filter((d) => d.code === RULE_CODE);
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("info");
    expect(hits[0].message).toContain("totally-other-repo");
    expect(hits[0].page_id).toBe("claim-unknown-repo");
  });

  it("does NOT trigger on tags without a repo: prefix", async () => {
    const vault = await mkTempVaultWithDeployments([{ repo: "knowledge-vault" }]);
    await writeClaimFile(vault, {
      id: "claim-plain-tags",
      key: "test.plain",
      status: "active",
      confidence: 0.7,
      tags: ["windows", "powershell", "knowledge-vault"], // no repo: prefix
    });
    const diags = await runOn(vault);
    expect(diags.filter((d) => d.code === RULE_CODE)).toHaveLength(0);
  });

  it("triggers info on `repo:` with empty value (malformed prefix)", async () => {
    const vault = await mkTempVaultWithDeployments([{ repo: "knowledge-vault" }]);
    await writeClaimFile(vault, {
      id: "claim-empty-prefix",
      key: "test.empty",
      status: "active",
      confidence: 0.7,
      tags: ["repo:"],
    });
    const diags = await runOn(vault);
    const hits = diags.filter((d) => d.code === RULE_CODE);
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("info");
    expect(hits[0].message.toLowerCase()).toMatch(/empty|malformed/);
    expect(hits[0].page_id).toBe("claim-empty-prefix");
  });

  it("does NOT throw and emits no diagnostics when deployments.json is missing", async () => {
    // mkTempVault (vs mkTempVaultWithDeployments) deliberately skips the sidecar.
    const vault = await mkTempVault();
    await writeClaimFile(vault, {
      id: "claim-no-sidecar",
      key: "test.nosidecar",
      status: "active",
      confidence: 0.7,
      tags: ["repo:something", "repo:"], // would normally trip multiple findings
    });
    const diags = await runOn(vault);
    expect(diags.filter((d) => d.code === RULE_CODE)).toHaveLength(0);
  });

  it("emits ONE finding per malformed/unknown tag (multiple tags on one claim)", async () => {
    const vault = await mkTempVaultWithDeployments([{ repo: "knowledge-vault" }]);
    await writeClaimFile(vault, {
      id: "claim-mixed",
      key: "test.mixed",
      status: "active",
      confidence: 0.7,
      tags: [
        "repo:knowledge-vault", // OK
        "repo:bogus-one",       // unknown → 1 finding
        "repo:",                // empty   → 1 finding
        "windows",              // skipped
      ],
    });
    const diags = await runOn(vault);
    const hits = diags.filter((d) => d.code === RULE_CODE);
    expect(hits).toHaveLength(2);
    const messages = hits.map((h) => h.message).join(" | ");
    expect(messages).toContain("bogus-one");
  });

  it("walks every wiki under wikis/* — picks up claims in non-_agents wikis", async () => {
    const vault = await mkTempVaultWithDeployments([{ repo: "knowledge-vault" }]);
    await writeClaimFile(vault, {
      id: "claim-in-alpha",
      key: "test.alpha",
      status: "active",
      confidence: 0.7,
      tags: ["repo:nope"],
      wiki: "alpha",
    });
    const diags = await runOn(vault);
    const hits = diags.filter((d) => d.code === RULE_CODE);
    expect(hits).toHaveLength(1);
    expect(hits[0].wiki).toBe("alpha");
  });

  it("ignores non-claim pages even if they carry a malformed repo: tag", async () => {
    const vault = await mkTempVaultWithDeployments([{ repo: "knowledge-vault" }]);
    // Place a non-claim file directly so the rule must skip it on type=
    const otherDir = path.join(vault, "wikis", "_agents", "concept");
    await fs.mkdir(otherDir, { recursive: true });
    const fm = [
      "---",
      `id: concept-x`,
      `type: concept`,
      `title: x`,
      `created: 2026-05-02`,
      `tags: ["repo:not-registered"]`,
      "---",
      "",
      "body",
    ].join("\n");
    await fs.writeFile(path.join(otherDir, "concept-x.md"), fm, "utf8");

    const diags = await runOn(vault);
    expect(diags.filter((d) => d.code === RULE_CODE)).toHaveLength(0);
  });

  it("tolerates a malformed claim file (parse error) without throwing", async () => {
    const vault = await mkTempVaultWithDeployments([{ repo: "knowledge-vault" }]);
    // Drop a file with no frontmatter at all — the walker must skip it.
    const dir = path.join(vault, "wikis", "_agents", "claim");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "claim-broken.md"), "no frontmatter here\n", "utf8");

    // Plus one valid claim that SHOULD trip the rule, to confirm the walker
    // didn't bail at the first failure.
    await writeClaimFile(vault, {
      id: "claim-real",
      key: "test.real",
      status: "active",
      confidence: 0.7,
      tags: ["repo:nope"],
    });

    const diags = await runOn(vault);
    const hits = diags.filter((d) => d.code === RULE_CODE);
    expect(hits).toHaveLength(1);
    expect(hits[0].page_id).toBe("claim-real");
  });
});
