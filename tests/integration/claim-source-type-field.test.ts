// tests/integration/claim-source-type-field.test.ts
//
// T1 of specialist-agent-substrate DAG. Verifies that the `source_type`
// field is accepted on the ClaimDraft schema with the correct enum values,
// defaults to "lived" when absent, and is persisted correctly when
// claim files are written and re-parsed via `parseClaim`.
//
// Spec §5.1: source_type: lived | curricular | retro, optional with default
// lived. Every existing claim is implicitly lived and remains valid.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { ClaimDraft, ClaimSourceType, parseClaim } from "../../src/types/claim.js";

// Minimal valid claim frontmatter (all required fields) without source_type.
const BASE_CLAIM = {
  id: "claim-test-source-type",
  type: "claim" as const,
  title: "test claim",
  created: "2026-05-19",
  key: "test.source.type",
  confidence: 0.8,
  last_validated: "2026-05-19",
  status: "active" as const,
};

describe("ClaimSourceType enum", () => {
  it("parses valid values: lived, curricular, retro", () => {
    expect(ClaimSourceType.parse("lived")).toBe("lived");
    expect(ClaimSourceType.parse("curricular")).toBe("curricular");
    expect(ClaimSourceType.parse("retro")).toBe("retro");
  });

  it("throws on invalid value", () => {
    expect(() => ClaimSourceType.parse("invalid")).toThrow();
  });
});

describe("ClaimDraft — source_type field", () => {
  it("defaults to 'lived' when source_type is absent", () => {
    const result = ClaimDraft.parse(BASE_CLAIM);
    expect(result.source_type).toBe("lived");
  });

  it("accepts source_type: 'lived' explicitly", () => {
    const result = ClaimDraft.parse({ ...BASE_CLAIM, source_type: "lived" });
    expect(result.source_type).toBe("lived");
  });

  it("accepts source_type: 'curricular'", () => {
    const result = ClaimDraft.parse({ ...BASE_CLAIM, source_type: "curricular" });
    expect(result.source_type).toBe("curricular");
  });

  it("accepts source_type: 'retro'", () => {
    const result = ClaimDraft.parse({ ...BASE_CLAIM, source_type: "retro" });
    expect(result.source_type).toBe("retro");
  });

  it("throws on invalid source_type value", () => {
    expect(() =>
      ClaimDraft.parse({ ...BASE_CLAIM, source_type: "invalid" })
    ).toThrow();
  });
});

describe("parseClaim — source_type integration with file fixtures", () => {
  let vault: string;

  function writeClaimFixture(id: string, sourceType: string | undefined): string {
    const claimDir = join(vault, "wikis", "_agents", "claim");
    mkdirSync(claimDir, { recursive: true });
    const sourceTypeLine = sourceType !== undefined
      ? `source_type: "${sourceType}"\n`
      : "";
    const content = `---
id: "${id}"
type: "claim"
title: "${id}"
created: "2026-05-19"
key: "test.parseclaim.${id}"
confidence: 0.8
last_validated: "2026-05-19"
status: "active"
wiki: "_agents"
summary: "test"
updated: "2026-05-19"
authored_by: "agent:test"
${sourceTypeLine}---

body
`;
    const filePath = join(claimDir, `${id}.md`);
    writeFileSync(filePath, content, "utf8");
    return filePath;
  }

  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), "vault-source-type-test-"));
  });

  afterEach(() => {
    if (vault) rmSync(vault, { recursive: true, force: true });
  });

  it("parseClaim on a file without source_type returns source_type: 'lived'", async () => {
    const filePath = writeClaimFixture("claim-no-source-type", undefined);
    const raw = await fs.readFile(filePath, "utf8");
    // Parse frontmatter manually (crude but sufficient for this test)
    const fm = parseYamlFrontmatter(raw);
    const result = parseClaim(fm);
    expect(result.source_type).toBe("lived");
  });

  it("parseClaim on a file with source_type: 'curricular' returns 'curricular'", async () => {
    const filePath = writeClaimFixture("claim-curricular", "curricular");
    const raw = await fs.readFile(filePath, "utf8");
    const fm = parseYamlFrontmatter(raw);
    const result = parseClaim(fm);
    expect(result.source_type).toBe("curricular");
  });

  it("parseClaim on a file with source_type: 'retro' returns 'retro'", async () => {
    const filePath = writeClaimFixture("claim-retro", "retro");
    const raw = await fs.readFile(filePath, "utf8");
    const fm = parseYamlFrontmatter(raw);
    const result = parseClaim(fm);
    expect(result.source_type).toBe("retro");
  });
});

// Minimal YAML frontmatter parser. Handles quoted strings, numbers, and
// null. Sufficient for the simple claim fixtures in this test file.
function parseYamlFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error("No frontmatter found");
  const lines = match[1].split("\n");
  const result: Record<string, unknown> = {};
  for (const line of lines) {
    if (!line.trim()) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const rawVal = line.slice(colonIdx + 1).trim();
    if (rawVal === "null") {
      result[key] = null;
    } else if (rawVal.startsWith('"') && rawVal.endsWith('"')) {
      result[key] = rawVal.slice(1, -1);
    } else if (rawVal === "true") {
      result[key] = true;
    } else if (rawVal === "false") {
      result[key] = false;
    } else if (!isNaN(Number(rawVal)) && rawVal !== "") {
      result[key] = Number(rawVal);
    } else {
      result[key] = rawVal;
    }
  }
  return result;
}
