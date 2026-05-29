import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _clearIndexCache } from "./index.js";
import { countCuratable } from "./curation-count.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVault(): string {
  const vault = mkdtempSync(join(tmpdir(), "stoa-count-"));
  mkdirSync(join(vault, "_index"), { recursive: true });
  return vault;
}

function writePage(vault: string, relPath: string, fm: Record<string, unknown>, body = ""): void {
  const dir = join(vault, relPath.split("/").slice(0, -1).join("/"));
  mkdirSync(dir, { recursive: true });
  const frontmatterLines = Object.entries(fm)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? `"${v}"` : JSON.stringify(v)}`)
    .join("\n");
  writeFileSync(join(vault, relPath), `---\n${frontmatterLines}\n---\n${body}`);
}

function writeIndex(vault: string, pages: unknown[]): void {
  writeFileSync(join(vault, "_index", "pages.json"), JSON.stringify({ pages }, null, 2));
  writeFileSync(join(vault, "_index", "wikis.json"), JSON.stringify({ wikis: [] }, null, 2));
  writeFileSync(join(vault, "_index", "links.json"), JSON.stringify({}, null, 2));
}

/**
 * Snapshot every file's byte content under the vault directory.
 * Returns a Map<relative-path, string-content>.
 */
function snapshotVault(vaultPath: string): Map<string, string> {
  const snap = new Map<string, string>();
  function walk(dir: string): void {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else {
        const rel = full.slice(vaultPath.length);
        snap.set(rel, readFileSync(full, "utf8"));
      }
    }
  }
  walk(vaultPath);
  return snap;
}

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

// A stale draft with no inbound links — ARCHIVE_STALE rule will flag it.
// Default config: confidence_floor: "medium", auto_archive_human: false.
// ARCHIVE_STALE produces confidence "high" with agent author → applies: true.
const STALE_AGENT_DRAFT_PATH = "wikis/alpha/idea/idea-stale.md";
// Created 2020-01-01 — well over 60 days ago from any 2026 date
const STALE_CREATED = "2020-01-01";

// A different wiki — stale agent page there too
const OTHER_WIKI_PATH = "wikis/beta/idea/idea-other.md";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("countCuratable", () => {
  let vault: string;

  beforeEach(() => {
    _clearIndexCache();

    vault = makeVault();

    // Stale agent draft in alpha: triggers ARCHIVE_STALE (confidence "high", agent → applies: true)
    writePage(vault, STALE_AGENT_DRAFT_PATH, {
      id: "idea-stale",
      title: "Stale Idea",
      type: "idea",
      wiki: "alpha",
      status: "draft",
      created: STALE_CREATED,
      author: "agent:charmander",
    });

    // Stale agent draft in beta: also triggers ARCHIVE_STALE
    writePage(vault, OTHER_WIKI_PATH, {
      id: "idea-other",
      title: "Other Wiki Idea",
      type: "idea",
      wiki: "beta",
      status: "draft",
      created: STALE_CREATED,
      author: "agent:charmander",
    });

    writeIndex(vault, [
      {
        id: "idea-stale",
        wiki: "alpha",
        type: "idea",
        status: "draft",
        path: STALE_AGENT_DRAFT_PATH,
        title: "Stale Idea",
        summary: "",
        tags: [],
        updated: "",
        created: STALE_CREATED,
      },
      {
        id: "idea-other",
        wiki: "beta",
        type: "idea",
        status: "draft",
        path: OTHER_WIKI_PATH,
        title: "Other Idea",
        summary: "",
        tags: [],
        updated: "",
        created: STALE_CREATED,
      },
    ]);
  });

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
    _clearIndexCache();
  });

  it("returns a number ≥ 0 (basic contract)", () => {
    const n = countCuratable(vault);
    expect(typeof n).toBe("number");
    expect(n).toBeGreaterThanOrEqual(0);
  });

  it("counts only would-apply actions, performs no writes", () => {
    const before = snapshotVault(vault);
    const n = countCuratable(vault);
    expect(typeof n).toBe("number");
    expect(snapshotVault(vault)).toEqual(before); // no mutation
  });

  it("returns a count ≥ 1 for a fixture vault with at least one applicable action", () => {
    const n = countCuratable(vault);
    // The stale agent draft in alpha triggers ARCHIVE_STALE: confidence "high" ≥ floor "medium",
    // agent author → auto_archive_human gate is not in play → applies: true
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it("wiki filter excludes pages from other wikis", () => {
    const alphaOnly = countCuratable(vault, "alpha");
    const betaOnly = countCuratable(vault, "beta");
    const all = countCuratable(vault);
    // Together the wiki-scoped counts must sum to the total
    // (each fixture page belongs to exactly one wiki)
    expect(alphaOnly + betaOnly).toBe(all);
  });

  it("wiki filter narrows count — alpha and beta counts are each ≥ 1", () => {
    const alphaOnly = countCuratable(vault, "alpha");
    const betaOnly = countCuratable(vault, "beta");
    // Both wikis have stale agent drafts, so each should produce ≥ 1 applicable action
    expect(alphaOnly).toBeGreaterThanOrEqual(1);
    expect(betaOnly).toBeGreaterThanOrEqual(1);
  });
});
