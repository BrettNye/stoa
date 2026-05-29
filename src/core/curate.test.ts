// src/core/curate.test.ts
//
// Integration tests for the curate() orchestrator.
//
// Strategy: build a real temp vault with:
//   - an _index (pages.json, tokens.json, wikis.json, links.json)
//   - a stale orphan agent-authored draft idea → triggers ARCHIVE_STALE (high confidence, agent-authored → gate allows)
//   - an active agent-authored idea page (recent, but no summary) → might trigger PROMOTE_ACTIVE flagged
//
// The fixture is designed so at least one action applies (archive the stale draft),
// enabling end-to-end coverage of apply → writePage → upsertPage → journal.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { curate } from "./curate.js";
import { _clearIndexCache } from "./index.js";

// ─── Vault fixture helpers ────────────────────────────────────────────────────

function makeVault(): string {
  const vault = mkdtempSync(join(tmpdir(), "stoa-curate-test-"));
  mkdirSync(join(vault, "_index"), { recursive: true });
  // Seed empty sidecars
  writeFileSync(join(vault, "_index", "pages.json"), JSON.stringify({ pages: [] }));
  writeFileSync(join(vault, "_index", "tokens.json"), JSON.stringify({}));
  writeFileSync(join(vault, "_index", "wikis.json"), JSON.stringify({ wikis: [] }));
  writeFileSync(join(vault, "_index", "links.json"), JSON.stringify({}));
  return vault;
}

/**
 * Write a page file and add it to pages.json index.
 * Returns the vault-relative path.
 */
function seedPage(
  vault: string,
  opts: {
    id: string;
    type: string;
    wiki: string;
    status: string;
    created: string;
    updated?: string;
    author?: string;
    summary?: string;
    folder?: string; // override default folder
    inbound?: string[]; // ids that link to this page
  },
): string {
  const folder = opts.folder ?? `${opts.type}s`; // ideas, concepts, specs, ...
  const relPath = `wikis/${opts.wiki}/${folder}/${opts.id}.md`;
  const absDir = join(vault, "wikis", opts.wiki, folder);
  mkdirSync(absDir, { recursive: true });

  const fm: Record<string, string | undefined> = {
    id: opts.id,
    title: `Test ${opts.id}`,
    type: opts.type,
    wiki: opts.wiki,
    status: opts.status,
    created: opts.created,
  };
  if (opts.updated) fm.updated = opts.updated;
  if (opts.author) fm.author = opts.author;
  if (opts.summary) fm.summary = opts.summary;

  const fmLines = Object.entries(fm)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: "${v}"`)
    .join("\n");

  writeFileSync(join(vault, relPath), `---\n${fmLines}\n---\npage body\n`);

  // Upsert into pages.json
  const pagesPath = join(vault, "_index", "pages.json");
  const pagesData = JSON.parse(readFileSync(pagesPath, "utf8")) as { pages: unknown[] };
  pagesData.pages.push({
    id: opts.id,
    type: opts.type,
    wiki: opts.wiki,
    title: `Test ${opts.id}`,
    summary: opts.summary ?? "",
    tags: [],
    status: opts.status,
    updated: opts.updated ?? opts.created,
    created: opts.created,
    path: relPath,
  });
  writeFileSync(pagesPath, JSON.stringify(pagesData, null, 2));

  // If inbound links specified, update links.json
  if (opts.inbound && opts.inbound.length > 0) {
    const linksPath = join(vault, "_index", "links.json");
    const linksData = JSON.parse(readFileSync(linksPath, "utf8")) as Record<string, { outbound: string[]; inbound: string[] }>;
    linksData[opts.id] = { outbound: [], inbound: opts.inbound };
    writeFileSync(linksPath, JSON.stringify(linksData, null, 2));
  }

  return relPath;
}

/** Snapshot the vault's file byte contents (for dry_run write-nothing check). */
function snapshotVault(vault: string): Map<string, string> {
  const snap = new Map<string, string>();
  function walk(dir: string): void {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          snap.set(full, readFileSync(full, "utf8"));
        }
      }
    } catch {
      // ignore
    }
  }
  walk(vault);
  return snap;
}

// ─── Test state ───────────────────────────────────────────────────────────────

let vault: string;

// A stale orphan agent-authored draft → ARCHIVE_STALE fires, gate passes (agent, high confidence)
const STALE_ID = "idea-stale-orphan";
// A recently-updated draft → no rule fires (within staleness window)
const FRESH_ID = "idea-fresh";

beforeEach(() => {
  vault = makeVault();
  _clearIndexCache();

  // Very old stale draft, no inbound links, agent-authored → ARCHIVE_STALE(high, agent) → applies
  seedPage(vault, {
    id: STALE_ID,
    type: "idea",
    wiki: "_meta",
    status: "draft",
    created: "2020-01-01",
    updated: "2020-01-01",
    author: "agent:tester",
    folder: "ideas",
  });

  // Recent draft (shouldn't trigger ARCHIVE_STALE)
  const today = new Date().toISOString().slice(0, 10);
  seedPage(vault, {
    id: FRESH_ID,
    type: "idea",
    wiki: "_meta",
    status: "draft",
    created: today,
    updated: today,
    author: "agent:tester",
    folder: "ideas",
  });
});

afterEach(() => {
  try { rmSync(vault, { recursive: true, force: true }); } catch { /* ignore */ }
  _clearIndexCache();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("curate() — dry_run", () => {
  it("returns applied/flagged arrays without writing any files", async () => {
    const before = snapshotVault(vault);
    const result = await curate(vault, "test-agent", { dry_run: true });

    expect(Array.isArray(result.applied)).toBe(true);
    expect(Array.isArray(result.flagged)).toBe(true);
    expect(result.journal_id).toBeUndefined();

    const after = snapshotVault(vault);
    // No files added or modified
    expect(after.size).toBe(before.size);
    for (const [path, content] of before) {
      expect(after.get(path)).toBe(content);
    }
  });

  it("dry_run detects the stale orphan as an applies:true action", async () => {
    const result = await curate(vault, "test-agent", { dry_run: true });
    const staleAction = result.applied.find(a => a.page_id === STALE_ID);
    expect(staleAction).toBeDefined();
    expect(staleAction!.to_status).toBe("archived");
  });
});

describe("curate() — real run", () => {
  it("applies the ARCHIVE_STALE action: page status becomes archived", async () => {
    const result = await curate(vault, "test-agent");

    expect(result.applied.length).toBeGreaterThan(0);
    const staleAction = result.applied.find(a => a.page_id === STALE_ID);
    expect(staleAction).toBeDefined();

    // Read the file back and check status changed
    const pageFile = join(vault, "wikis/_meta/ideas", `${STALE_ID}.md`);
    const raw = readFileSync(pageFile, "utf8");
    expect(raw).toContain("status: archived");
  });

  it("writes exactly one digest journal whose id ends -curation-run", async () => {
    const result = await curate(vault, "test-agent");

    expect(result.journal_id).toBeDefined();
    expect(result.journal_id).toMatch(/-curation-run$/);
  });

  it("digest journal file exists in wikis/_meta/journal/", async () => {
    const result = await curate(vault, "test-agent");

    const journalPath = join(vault, "wikis", "_meta", "journal", `${result.journal_id!}.md`);
    expect(existsSync(journalPath)).toBe(true);
  });

  it("the stale page's field_patch (archived_at) is written to disk", async () => {
    const result = await curate(vault, "test-agent");
    const staleAction = result.applied.find(a => a.page_id === STALE_ID);
    expect(staleAction?.field_patch?.archived_at).toBeDefined();

    const pageFile = join(vault, "wikis/_meta/ideas", `${STALE_ID}.md`);
    const raw = readFileSync(pageFile, "utf8");
    expect(raw).toContain("archived_at");
  });

  it("returns journal_id (not undefined) when not dry_run", async () => {
    const result = await curate(vault, "test-agent");
    expect(result.journal_id).toBeDefined();
    expect(typeof result.journal_id).toBe("string");
    expect(result.journal_id!.length).toBeGreaterThan(0);
  });
});

describe("curate() — idempotency", () => {
  it("second run produces empty applied set (already at target status)", async () => {
    // First run applies ARCHIVE_STALE on STALE_ID
    const first = await curate(vault, "test-agent");
    expect(first.applied.find(a => a.page_id === STALE_ID)).toBeDefined();

    // Clear cache so second run reloads from disk
    _clearIndexCache();

    // Second run: the page is now archived → ARCHIVE_STALE only targets draft → no action
    const second = await curate(vault, "test-agent");
    // The stale page should NOT appear in applied again
    const staleActionAgain = second.applied.find(a => a.page_id === STALE_ID);
    expect(staleActionAgain).toBeUndefined();
  });
});

describe("curate() — httpMode / no runner forces unknown verifyPrMerged", () => {
  it("httpMode:true runs without crashing and returns a result", async () => {
    // httpMode:true should not call verifyPrMerged via the runner
    const result = await curate(vault, "test-agent", { httpMode: true });
    expect(Array.isArray(result.applied)).toBe(true);
    expect(Array.isArray(result.flagged)).toBe(true);
    // journal should be written
    expect(result.journal_id).toBeDefined();
  });

  it("omitting runner (undefined) also runs without crashing", async () => {
    // No runner passed → verifyPrMerged should default to 'unknown'
    const result = await curate(vault, "test-agent", {}, undefined);
    expect(Array.isArray(result.applied)).toBe(true);
    expect(result.journal_id).toBeDefined();
  });
});

describe("curate() — wiki scoping", () => {
  it("when wiki is specified, journal is written to that wiki's journal dir", async () => {
    // Seed another wiki
    seedPage(vault, {
      id: "idea-other-stale",
      type: "idea",
      wiki: "other",
      status: "draft",
      created: "2019-01-01",
      updated: "2019-01-01",
      author: "agent:tester",
      folder: "ideas",
    });
    _clearIndexCache();

    const result = await curate(vault, "test-agent", { wiki: "other" });
    expect(result.journal_id).toBeDefined();
    const journalPath = join(vault, "wikis", "other", "journal", `${result.journal_id!}.md`);
    expect(existsSync(journalPath)).toBe(true);
  });
});
