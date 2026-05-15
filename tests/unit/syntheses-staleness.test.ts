// Tests for listSynthesesWithStaleness in stoa/src/core/syntheses.ts
//
// Strategy: seed a temporary vault with hand-rolled _index/{pages,links}.json
// and minimal synthesis markdown files. Tests are fast and fully self-contained
// with no dependency on the real vault or reindex pipeline.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  listSynthesesWithStaleness,
  type SynthesisStaleness,
  type SynthesisStalenessInput,
  type ListSynthesesOptions,
} from "../../src/core/syntheses.js";

// ── helpers ──────────────────────────────────────────────────────────────────

let vaultPath: string;

function setupVault(): string {
  const dir = join(tmpdir(), `syntheses-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, "_index"), { recursive: true });
  mkdirSync(join(dir, "wikis", "wiki-a", "synthesis"), { recursive: true });
  mkdirSync(join(dir, "wikis", "wiki-b", "synthesis"), { recursive: true });
  return dir;
}

function writePagesJson(vault: string, pages: object[]): void {
  writeFileSync(join(vault, "_index", "pages.json"), JSON.stringify({ pages }, null, 2));
}

function writeLinksJson(vault: string, links: Record<string, { outbound: string[]; inbound: string[] }>): void {
  writeFileSync(join(vault, "_index", "links.json"), JSON.stringify(links, null, 2));
}

function writeSynthesisFile(
  vault: string,
  wiki: string,
  id: string,
  lastCompiled: string | null
): void {
  const lc = lastCompiled ? `last_compiled: '${lastCompiled}'\n` : "";
  const content = `---\nid: ${id}\ntype: synthesis\nwiki: ${wiki}\ntitle: Test synthesis\ncreated: '2026-01-01'\nupdated: '2026-01-01'\n${lc}---\nBody text.\n`;
  writeFileSync(join(vault, "wikis", wiki, "synthesis", `${id}.md`), content);
}

function makePageEntry(overrides: {
  id: string;
  type?: string;
  wiki?: string;
  updated?: string;
  path?: string;
}) {
  return {
    id: overrides.id,
    type: overrides.type ?? "concept",
    wiki: overrides.wiki ?? "wiki-a",
    title: overrides.id,
    summary: "",
    tags: [],
    status: "active",
    updated: overrides.updated ?? "2026-01-01",
    created: "2026-01-01",
    path: overrides.path ?? `wikis/${overrides.wiki ?? "wiki-a"}/concepts/${overrides.id}.md`,
  };
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("listSynthesesWithStaleness", () => {
  beforeEach(() => {
    vaultPath = setupVault();
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  // (c) Cold vault — missing index files
  it("returns [] when _index/pages.json is missing", () => {
    // Only links.json present — pages.json absent
    writeLinksJson(vaultPath, {});
    const result = listSynthesesWithStaleness(vaultPath);
    expect(result).toEqual([]);
  });

  it("returns [] when _index/links.json is missing", () => {
    // Only pages.json present — links.json absent
    writePagesJson(vaultPath, []);
    const result = listSynthesesWithStaleness(vaultPath);
    expect(result).toEqual([]);
  });

  it("returns [] when both index files are missing", () => {
    const result = listSynthesesWithStaleness(vaultPath);
    expect(result).toEqual([]);
  });

  it("returns [] when there are no synthesis pages", () => {
    writePagesJson(vaultPath, [
      makePageEntry({ id: "concept-foo", type: "concept" }),
    ]);
    writeLinksJson(vaultPath, {});
    const result = listSynthesesWithStaleness(vaultPath);
    expect(result).toEqual([]);
  });

  // (a) Sort order: null lag (never compiled) sorts ABOVE any numeric lag
  it("sorts null lag (never compiled) before numeric lag", () => {
    const synthId1 = "synthesis-compiled";
    const synthId2 = "synthesis-never-compiled";

    writePagesJson(vaultPath, [
      makePageEntry({
        id: synthId1,
        type: "synthesis",
        wiki: "wiki-a",
        updated: "2026-01-15",
        path: `wikis/wiki-a/synthesis/${synthId1}.md`,
      }),
      makePageEntry({
        id: synthId2,
        type: "synthesis",
        wiki: "wiki-a",
        updated: "2026-01-01",
        path: `wikis/wiki-a/synthesis/${synthId2}.md`,
      }),
    ]);
    writeLinksJson(vaultPath, {
      [synthId1]: { outbound: [], inbound: [] },
      [synthId2]: { outbound: [], inbound: [] },
    });

    // synthId1 was compiled (has last_compiled), synthId2 was never compiled
    writeSynthesisFile(vaultPath, "wiki-a", synthId1, "2026-01-10");
    writeSynthesisFile(vaultPath, "wiki-a", synthId2, null);

    const result = listSynthesesWithStaleness(vaultPath);
    expect(result).toHaveLength(2);
    // null lag always first
    expect(result[0].id).toBe(synthId2);
    expect(result[0].last_compiled).toBeNull();
    expect(result[0].lag_days).toBeNull();
    // compiled second
    expect(result[1].id).toBe(synthId1);
    expect(result[1].last_compiled).toBe("2026-01-10");
    expect(result[1].lag_days).toBeTypeOf("number");
  });

  it("sorts by descending lag_days among compiled syntheses (most stale first)", () => {
    // Use a fixed "now" so lag_days is deterministic:
    // synthA compiled 2026-01-01 → older (more stale)
    // synthB compiled 2026-04-01 → newer (less stale)
    const synthA = "synthesis-a";
    const synthB = "synthesis-b";

    writePagesJson(vaultPath, [
      makePageEntry({
        id: synthA,
        type: "synthesis",
        wiki: "wiki-a",
        path: `wikis/wiki-a/synthesis/${synthA}.md`,
      }),
      makePageEntry({
        id: synthB,
        type: "synthesis",
        wiki: "wiki-a",
        path: `wikis/wiki-a/synthesis/${synthB}.md`,
      }),
    ]);
    writeLinksJson(vaultPath, {
      [synthA]: { outbound: [], inbound: [] },
      [synthB]: { outbound: [], inbound: [] },
    });

    writeSynthesisFile(vaultPath, "wiki-a", synthA, "2026-01-01");
    writeSynthesisFile(vaultPath, "wiki-a", synthB, "2026-04-01");

    const result = listSynthesesWithStaleness(vaultPath);
    expect(result).toHaveLength(2);
    // synthA is more stale (older last_compiled) → comes first
    expect(result[0].id).toBe(synthA);
    expect(result[1].id).toBe(synthB);
    // lag_days should be >= 0 and synthA's lag > synthB's lag
    expect(result[0].lag_days!).toBeGreaterThan(result[1].lag_days!);
  });

  // (b) stale_inputs populated correctly when last_compiled is set
  it("populates stale_inputs with related pages updated after last_compiled", () => {
    const synthId = "synthesis-topic";
    const conceptFresh = "concept-fresh";
    const conceptStale = "concept-stale";

    writePagesJson(vaultPath, [
      makePageEntry({
        id: synthId,
        type: "synthesis",
        wiki: "wiki-a",
        path: `wikis/wiki-a/synthesis/${synthId}.md`,
      }),
      makePageEntry({
        id: conceptFresh,
        type: "concept",
        wiki: "wiki-a",
        updated: "2026-01-01", // before last_compiled (2026-02-01) → NOT stale
      }),
      makePageEntry({
        id: conceptStale,
        type: "concept",
        wiki: "wiki-a",
        updated: "2026-03-01", // after last_compiled → stale
      }),
    ]);
    writeLinksJson(vaultPath, {
      [synthId]: { outbound: [conceptFresh, conceptStale], inbound: [] },
    });
    writeSynthesisFile(vaultPath, "wiki-a", synthId, "2026-02-01");

    const result = listSynthesesWithStaleness(vaultPath);
    expect(result).toHaveLength(1);
    const row = result[0];
    expect(row.id).toBe(synthId);
    expect(row.stale_inputs).toHaveLength(1);
    expect(row.stale_inputs[0].id).toBe(conceptStale);
    expect(row.stale_inputs[0].updated).toBe("2026-03-01");
  });

  it("stale_inputs excludes pages updated on the same day as last_compiled (strict greater-than)", () => {
    const synthId = "synthesis-exact";
    const conceptSameDay = "concept-same-day";

    writePagesJson(vaultPath, [
      makePageEntry({
        id: synthId,
        type: "synthesis",
        wiki: "wiki-a",
        path: `wikis/wiki-a/synthesis/${synthId}.md`,
      }),
      makePageEntry({
        id: conceptSameDay,
        type: "concept",
        wiki: "wiki-a",
        updated: "2026-02-01", // same day as last_compiled → NOT stale (strict >)
      }),
    ]);
    writeLinksJson(vaultPath, {
      [synthId]: { outbound: [conceptSameDay], inbound: [] },
    });
    writeSynthesisFile(vaultPath, "wiki-a", synthId, "2026-02-01");

    const result = listSynthesesWithStaleness(vaultPath);
    expect(result).toHaveLength(1);
    expect(result[0].stale_inputs).toHaveLength(0);
  });

  it("when last_compiled is null, all related pages with updated are stale inputs", () => {
    const synthId = "synthesis-fresh";
    const conceptA = "concept-a";
    const conceptB = "concept-b";

    writePagesJson(vaultPath, [
      makePageEntry({
        id: synthId,
        type: "synthesis",
        wiki: "wiki-a",
        path: `wikis/wiki-a/synthesis/${synthId}.md`,
      }),
      makePageEntry({ id: conceptA, type: "concept", wiki: "wiki-a", updated: "2026-01-01" }),
      makePageEntry({ id: conceptB, type: "concept", wiki: "wiki-a", updated: "2026-02-01" }),
    ]);
    writeLinksJson(vaultPath, {
      [synthId]: { outbound: [conceptA, conceptB], inbound: [] },
    });
    writeSynthesisFile(vaultPath, "wiki-a", synthId, null);

    const result = listSynthesesWithStaleness(vaultPath);
    expect(result).toHaveLength(1);
    expect(result[0].stale_inputs).toHaveLength(2);
    const staleIds = result[0].stale_inputs.map(s => s.id).sort();
    expect(staleIds).toEqual([conceptA, conceptB].sort());
  });

  it("opts.wiki scopes results to a single wiki", () => {
    const synthA = "synthesis-wiki-a";
    const synthB = "synthesis-wiki-b";

    writePagesJson(vaultPath, [
      makePageEntry({
        id: synthA,
        type: "synthesis",
        wiki: "wiki-a",
        path: `wikis/wiki-a/synthesis/${synthA}.md`,
      }),
      makePageEntry({
        id: synthB,
        type: "synthesis",
        wiki: "wiki-b",
        path: `wikis/wiki-b/synthesis/${synthB}.md`,
      }),
    ]);
    writeLinksJson(vaultPath, {
      [synthA]: { outbound: [], inbound: [] },
      [synthB]: { outbound: [], inbound: [] },
    });
    writeSynthesisFile(vaultPath, "wiki-a", synthA, "2026-01-01");
    writeSynthesisFile(vaultPath, "wiki-b", synthB, "2026-01-01");

    const result = listSynthesesWithStaleness(vaultPath, { wiki: "wiki-a" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(synthA);
  });

  it("opts.min_lag_days filters out syntheses below the threshold", () => {
    const synthOld = "synthesis-old";
    const synthNew = "synthesis-new";

    // Use fixed dates relative to test to control lag:
    // synthOld was compiled 400 days ago (approximate), synthNew 5 days ago.
    // Rather than mocking Date, we just use dates where synthOld should have
    // a larger lag. We'll pick dates far enough in the past that min_lag_days
    // can filter the new one.
    writePagesJson(vaultPath, [
      makePageEntry({
        id: synthOld,
        type: "synthesis",
        wiki: "wiki-a",
        path: `wikis/wiki-a/synthesis/${synthOld}.md`,
      }),
      makePageEntry({
        id: synthNew,
        type: "synthesis",
        wiki: "wiki-a",
        path: `wikis/wiki-a/synthesis/${synthNew}.md`,
      }),
    ]);
    writeLinksJson(vaultPath, {
      [synthOld]: { outbound: [], inbound: [] },
      [synthNew]: { outbound: [], inbound: [] },
    });
    writeSynthesisFile(vaultPath, "wiki-a", synthOld, "2024-01-01"); // ~500+ days old
    writeSynthesisFile(vaultPath, "wiki-a", synthNew, "2026-05-11"); // ~1 day ago

    const result = listSynthesesWithStaleness(vaultPath, { min_lag_days: 100 });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(synthOld);
  });

  it("opts.min_lag_days always retains null-lag entries", () => {
    const synthNeverCompiled = "synthesis-never";
    const synthRecent = "synthesis-recent";

    writePagesJson(vaultPath, [
      makePageEntry({
        id: synthNeverCompiled,
        type: "synthesis",
        wiki: "wiki-a",
        path: `wikis/wiki-a/synthesis/${synthNeverCompiled}.md`,
      }),
      makePageEntry({
        id: synthRecent,
        type: "synthesis",
        wiki: "wiki-a",
        path: `wikis/wiki-a/synthesis/${synthRecent}.md`,
      }),
    ]);
    writeLinksJson(vaultPath, {
      [synthNeverCompiled]: { outbound: [], inbound: [] },
      [synthRecent]: { outbound: [], inbound: [] },
    });
    writeSynthesisFile(vaultPath, "wiki-a", synthNeverCompiled, null);
    writeSynthesisFile(vaultPath, "wiki-a", synthRecent, "2026-05-11");

    // With a high threshold, the recent one is filtered but never-compiled is kept
    const result = listSynthesesWithStaleness(vaultPath, { min_lag_days: 9999 });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(synthNeverCompiled);
    expect(result[0].lag_days).toBeNull();
  });

  it("lag_days is computed as Math.floor((now - last_compiled) / day)", () => {
    const synthId = "synthesis-lag-test";

    writePagesJson(vaultPath, [
      makePageEntry({
        id: synthId,
        type: "synthesis",
        wiki: "wiki-a",
        path: `wikis/wiki-a/synthesis/${synthId}.md`,
      }),
    ]);
    writeLinksJson(vaultPath, { [synthId]: { outbound: [], inbound: [] } });

    // Use a date exactly 30 days before today.
    // Computed at test time so the assertion does not rot as wall-clock moves.
    const day = 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = new Date(Date.now() - 30 * day).toISOString().slice(0, 10);
    writeSynthesisFile(vaultPath, "wiki-a", synthId, thirtyDaysAgo);

    const result = listSynthesesWithStaleness(vaultPath);
    expect(result).toHaveLength(1);
    const lag = result[0].lag_days;
    expect(lag).not.toBeNull();
    expect(lag).toBe(30);
  });

  it("returns SynthesisStaleness with all required fields", () => {
    const synthId = "synthesis-full-shape";

    writePagesJson(vaultPath, [
      makePageEntry({
        id: synthId,
        type: "synthesis",
        wiki: "wiki-a",
        path: `wikis/wiki-a/synthesis/${synthId}.md`,
        updated: "2026-01-15",
      }),
    ]);
    writeLinksJson(vaultPath, { [synthId]: { outbound: [], inbound: [] } });
    writeSynthesisFile(vaultPath, "wiki-a", synthId, "2026-01-10");

    const result = listSynthesesWithStaleness(vaultPath);
    expect(result).toHaveLength(1);
    const row = result[0];
    // Check all fields exist
    expect(row).toHaveProperty("id");
    expect(row).toHaveProperty("wiki");
    expect(row).toHaveProperty("title");
    expect(row).toHaveProperty("last_compiled");
    expect(row).toHaveProperty("lag_days");
    expect(row).toHaveProperty("stale_inputs");
    expect(Array.isArray(row.stale_inputs)).toBe(true);
    expect(row.id).toBe(synthId);
    expect(row.wiki).toBe("wiki-a");
  });

  it("handles a synthesis with no outbound links gracefully (empty stale_inputs)", () => {
    const synthId = "synthesis-no-links";

    writePagesJson(vaultPath, [
      makePageEntry({
        id: synthId,
        type: "synthesis",
        wiki: "wiki-a",
        path: `wikis/wiki-a/synthesis/${synthId}.md`,
      }),
    ]);
    writeLinksJson(vaultPath, { [synthId]: { outbound: [], inbound: [] } });
    writeSynthesisFile(vaultPath, "wiki-a", synthId, "2026-01-01");

    const result = listSynthesesWithStaleness(vaultPath);
    expect(result).toHaveLength(1);
    expect(result[0].stale_inputs).toEqual([]);
  });

  it("handles a synthesis not present in links.json gracefully (treats outbound as empty)", () => {
    const synthId = "synthesis-absent-from-links";

    writePagesJson(vaultPath, [
      makePageEntry({
        id: synthId,
        type: "synthesis",
        wiki: "wiki-a",
        path: `wikis/wiki-a/synthesis/${synthId}.md`,
      }),
    ]);
    // links.json exists but has no entry for this synthesis
    writeLinksJson(vaultPath, {});
    writeSynthesisFile(vaultPath, "wiki-a", synthId, "2026-01-01");

    const result = listSynthesesWithStaleness(vaultPath);
    expect(result).toHaveLength(1);
    expect(result[0].stale_inputs).toEqual([]);
  });
});
