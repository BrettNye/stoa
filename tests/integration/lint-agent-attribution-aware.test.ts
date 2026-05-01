import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reindex } from "../../src/core/reindex.js";
import { loadIndex } from "../../src/core/index.js";
import {
  runRegisteredChecks,
  type LintCheckCtx,
} from "../../src/core/lint-check.js";
import type { LintInput, Diagnostic } from "../../src/core/lint.js";

// Wave 3 / Phase-1 T3-4e — registry-backed AGENT_ATTRIBUTION_DRIFT check.
// Alias-tolerant counterpart to core/lint.ts's inline ALIAS_DRIFT:
//   - journal authored as agent:<X> is OK if <X> is a current profile id, OR
//     if <X> resolves through the alias index to a current profile id.
//   - journal authored as agent:<orphan> (no profile, no alias) within the
//     last 30 days is flagged severity:warning.
//
// Tests invoke `runRegisteredChecks` directly — same pattern as
// tests/integration/lint-cross-wiki-link-broken.test.ts.

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

function writeProfileFile(id: string, pokemonType = "fire") {
  const dir = join(vault, "wikis", "_agents", "profiles");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.md`), `---
id: ${id}
title: ${id}
type: profile
wiki: _agents
status: active
created: 2026-04-29
updated: 2026-04-29
summary: profile
pokemon_type: ${pokemonType}
evolution_stage: basic
moveset: []
---

# ${id}
`);
}

function writeJournal(wiki: string, id: string, author: string, createdISO: string) {
  const dir = join(vault, "wikis", wiki, "journal");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.md`), `---
id: ${id}
title: Journal ${id}
type: journal
wiki: ${wiki}
status: active
created: ${createdISO}
updated: ${createdISO}
summary: j
author: ${author}
---

body
`);
}

function writeAliases(map: Record<string, { current: string; history: string[] }>) {
  mkdirSync(join(vault, "_index"), { recursive: true });
  writeFileSync(join(vault, "_index", "aliases.json"), JSON.stringify(map, null, 2));
}

function runCheck(): Diagnostic[] {
  const idx = loadIndex(vault);
  const ctx: LintCheckCtx = { vaultPath: vault };
  const input: LintInput = {};
  const out = runRegisteredChecks(ctx, idx, input);
  return out.filter(d => d.code === "AGENT_ATTRIBUTION_DRIFT");
}

beforeAll(async () => {
  // Side-effect import to register the check.
  await import("../../src/core/lint-checks/agent-attribution-aware.js");
});

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-lint-aaa-"));
  mkdirSync(join(vault, "wikis", "_agents", "profiles"), { recursive: true });
  mkdirSync(join(vault, "wikis", "alpha", "journal"), { recursive: true });
  mkdirSync(join(vault, "_index"), { recursive: true });
  writeFileSync(join(vault, "_index", "aliases.json"), "{}");
  writeMap("_agents");
  writeMap("alpha");
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

describe("AGENT_ATTRIBUTION_DRIFT", () => {
  it("Case A — recorded alias: charmander → charmeleon, recent journal as agent:charmander → no diagnostic", async () => {
    writeProfileFile("profile-charmeleon");
    writeAliases({
      "profile-charmander": { current: "profile-charmeleon", history: ["profile-charmander"] }
    });
    writeJournal("alpha", "journal-2026-04-29-1500-a", "agent:charmander", new Date().toISOString());
    await reindex(vault);
    const diags = runCheck();
    expect(diags).toEqual([]);
  });

  it("Case B — current profile: agent:charmeleon matches profile-charmeleon → no diagnostic", async () => {
    writeProfileFile("profile-charmeleon");
    writeJournal("alpha", "journal-2026-04-29-1500-b", "agent:charmeleon", new Date().toISOString());
    await reindex(vault);
    const diags = runCheck();
    expect(diags).toEqual([]);
  });

  it("Case C — orphan id: agent:pikachu, no profile, no alias → one warning", async () => {
    writeJournal("alpha", "journal-2026-04-29-1500-c", "agent:pikachu", new Date().toISOString());
    await reindex(vault);
    const diags = runCheck();
    expect(diags.length).toBe(1);
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].code).toBe("AGENT_ATTRIBUTION_DRIFT");
    expect(diags[0].page_id).toBe("journal-2026-04-29-1500-c");
    expect(diags[0].wiki).toBe("alpha");
    expect(diags[0].message).toContain("pikachu");
  });

  it("Case D — old journal (35 days ago) with orphan id → no diagnostic (recency window)", async () => {
    const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
    writeJournal("alpha", "journal-2026-03-25-1500-d", "agent:pikachu", oldDate);
    await reindex(vault);
    const diags = runCheck();
    expect(diags).toEqual([]);
  });
});
