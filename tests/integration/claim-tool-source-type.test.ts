// tests/integration/claim-tool-source-type.test.ts
//
// T3 of specialist-agent-substrate DAG. Verifies that `vault.claim` accepts
// the optional `source_type` argument, persists it into frontmatter, and
// defaults to "lived" when absent.
//
// Acceptance criteria (spec §5.2):
// - Input schema accepts source_type: "lived" | "curricular" | "retro" | undefined.
// - Calling with source_type: "curricular" writes a claim with source_type: curricular.
// - Calling without source_type writes a claim whose parsed source_type is "lived".
// - Calling with source_type: "bogus" returns a zod validation error.
// - All three valid values + absent + invalid exercised.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import matter from "gray-matter";
import { callTool, mkTempVault } from "../helpers.js";

function writeMap(vault: string, wiki: string): void {
  const wikiDir = join(vault, "wikis", wiki);
  mkdirSync(wikiDir, { recursive: true });
  writeFileSync(
    join(wikiDir, "map.md"),
    `---
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
`,
  );
}

async function readClaimFrontmatter(vault: string, claimId: string): Promise<Record<string, unknown>> {
  const file = join(vault, "wikis", "_agents", "claim", `${claimId}.md`);
  const raw = await fs.readFile(file, "utf8");
  return matter(raw).data as Record<string, unknown>;
}

describe("vault.claim — source_type wiring", () => {
  let vault: string;

  beforeEach(async () => {
    vault = await mkTempVault();
    writeMap(vault, "_agents");
  });

  afterEach(() => {
    if (vault) rmSync(vault, { recursive: true, force: true });
  });

  it("writes source_type: curricular when explicitly provided", async () => {
    const result = await callTool(
      "vault_claim",
      {
        key: "test.source.curricular",
        title: "curricular claim",
        body: "learned from a course",
        confidence: 0.8,
        as: "agent:test",
        source_type: "curricular",
      },
      vault,
    );
    expect(result.action).toBe("created");
    const fm = await readClaimFrontmatter(vault, result.claim_id);
    expect(fm.source_type).toBe("curricular");
  });

  it("writes source_type: lived when explicitly provided", async () => {
    const result = await callTool(
      "vault_claim",
      {
        key: "test.source.lived",
        title: "lived claim",
        body: "from direct experience",
        confidence: 0.8,
        as: "agent:test",
        source_type: "lived",
      },
      vault,
    );
    expect(result.action).toBe("created");
    const fm = await readClaimFrontmatter(vault, result.claim_id);
    expect(fm.source_type).toBe("lived");
  });

  it("writes source_type: retro when explicitly provided", async () => {
    const result = await callTool(
      "vault_claim",
      {
        key: "test.source.retro",
        title: "retro claim",
        body: "reflection after the fact",
        confidence: 0.7,
        as: "agent:test",
        source_type: "retro",
      },
      vault,
    );
    expect(result.action).toBe("created");
    const fm = await readClaimFrontmatter(vault, result.claim_id);
    expect(fm.source_type).toBe("retro");
  });

  it("parses as 'lived' when source_type is absent from the call", async () => {
    const result = await callTool(
      "vault_claim",
      {
        key: "test.source.absent",
        title: "absent source_type claim",
        body: "no source_type given",
        confidence: 0.7,
        as: "agent:test",
        // no source_type arg
      },
      vault,
    );
    expect(result.action).toBe("created");
    const fm = await readClaimFrontmatter(vault, result.claim_id);
    // The schema default is "lived"; whether persisted explicitly or absent in
    // the file, parseClaim must yield "lived".
    const { parseClaim } = await import("../../src/types/claim.js");
    const parsed = parseClaim({ ...fm });
    expect(parsed.source_type).toBe("lived");
  });

  it("throws a validation error when source_type is an invalid value", async () => {
    await expect(
      callTool(
        "vault_claim",
        {
          key: "test.source.invalid",
          title: "invalid source_type claim",
          body: "bad value",
          confidence: 0.7,
          as: "agent:test",
          source_type: "bogus",
        },
        vault,
      ),
    ).rejects.toThrow();
  });
});
