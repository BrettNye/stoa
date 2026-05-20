// tests/integration/lint-claim-source-type.test.ts
//
// T2 of specialist-agent-substrate DAG. Integration test for the
// CLAIM_SOURCE_TYPE_INVALID lint rule (spec §5.2).
//
// Seeds three claim files:
//   1. valid — source_type: curricular (accepted value)
//   2. absent — no source_type field (defaults to lived; no diagnostic)
//   3. invalid — source_type: bogus (outside enum; emits error diagnostic)
//
// Asserts: exactly ONE diagnostic with code CLAIM_SOURCE_TYPE_INVALID,
// on the invalid file, with severity "error". No diagnostics on valid/absent.

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
created: 2026-05-19
updated: 2026-05-19
summary: m
---
m
`);
}

function writeClaim(
  wiki: string,
  id: string,
  sourceType: string | undefined,
  omitSourceType: boolean = false,
) {
  const dir = join(vault, "wikis", wiki, "claim");
  mkdirSync(dir, { recursive: true });
  const sourceTypeLine = omitSourceType
    ? ""
    : `source_type: "${sourceType}"\n`;
  const content = `---
id: "${id}"
type: "claim"
title: "${id}"
created: "2026-05-19"
key: "test.source.type.${id}"
confidence: 0.8
last_validated: "2026-05-19"
status: "active"
wiki: "${wiki}"
summary: "test"
updated: "2026-05-19"
authored_by: "agent:test"
${sourceTypeLine}---

body
`;
  writeFileSync(join(dir, `${id}.md`), content, "utf8");
}

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-lint-source-type-"));
  mkdirSync(join(vault, "wikis", "_agents", "claim"), { recursive: true });
  mkdirSync(join(vault, "_index"), { recursive: true });
  writeMap("_agents");
});

afterEach(() => {
  if (vault) rmSync(vault, { recursive: true, force: true });
});

async function runLint(wiki = "_agents") {
  await reindex(vault);
  return await lintTool.handler(
    { wiki, level: "error" },
    { vaultPath: vault },
  );
}

describe("CLAIM_SOURCE_TYPE_INVALID lint rule", () => {
  it("emits no diagnostic for a claim with source_type: curricular (valid value)", async () => {
    writeClaim("_agents", "claim-curricular", "curricular");
    const result = await runLint();
    const hits = result.diagnostics.filter(d => d.code === "CLAIM_SOURCE_TYPE_INVALID");
    expect(hits).toHaveLength(0);
  });

  it("emits no diagnostic for a claim without source_type field (absent = default lived)", async () => {
    writeClaim("_agents", "claim-absent", undefined, true);
    const result = await runLint();
    const hits = result.diagnostics.filter(d => d.code === "CLAIM_SOURCE_TYPE_INVALID");
    expect(hits).toHaveLength(0);
  });

  it("emits exactly one error diagnostic for a claim with source_type: bogus (invalid value)", async () => {
    writeClaim("_agents", "claim-bogus", "bogus");
    const result = await runLint();
    const hits = result.diagnostics.filter(d => d.code === "CLAIM_SOURCE_TYPE_INVALID");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("error");
    expect(hits[0].code).toBe("CLAIM_SOURCE_TYPE_INVALID");
    expect(hits[0].page_id).toBe("claim-bogus");
  });

  it("with all three files seeded: exactly ONE CLAIM_SOURCE_TYPE_INVALID diagnostic on the invalid file", async () => {
    writeClaim("_agents", "claim-curricular", "curricular");
    writeClaim("_agents", "claim-absent", undefined, true);
    writeClaim("_agents", "claim-bogus", "bogus");

    const result = await runLint();
    const hits = result.diagnostics.filter(d => d.code === "CLAIM_SOURCE_TYPE_INVALID");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("error");
    expect(hits[0].page_id).toBe("claim-bogus");
    // Valid and absent files produce no such diagnostics
    const invalidPageIds = hits.map(h => h.page_id);
    expect(invalidPageIds).not.toContain("claim-curricular");
    expect(invalidPageIds).not.toContain("claim-absent");
  });

  it("also does not fire for source_type: lived (valid value)", async () => {
    writeClaim("_agents", "claim-lived", "lived");
    const result = await runLint();
    const hits = result.diagnostics.filter(d => d.code === "CLAIM_SOURCE_TYPE_INVALID");
    expect(hits).toHaveLength(0);
  });

  it("also does not fire for source_type: retro (valid value)", async () => {
    writeClaim("_agents", "claim-retro", "retro");
    const result = await runLint();
    const hits = result.diagnostics.filter(d => d.code === "CLAIM_SOURCE_TYPE_INVALID");
    expect(hits).toHaveLength(0);
  });
});
