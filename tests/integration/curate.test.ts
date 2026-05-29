// tests/integration/curate.test.ts
//
// End-to-end integration tests for the vault_curate workflow (spec §6).
//
// Fixture vault covers all four rules in one run:
//   1. PROMOTE_LANDED  — spec page with a merged-PR impl ref, missing tags/related
//                        → promoted to active + flagged gap
//   2. ARCHIVE_STALE   — agent-authored stale orphan draft → archived
//   3. ARCHIVE_STALE   — human-authored stale orphan draft → flagged, not archived
//   4. RESOLVE_SUPERSEDE — page Y supersedes page X → X marked superseded
//
// Plus: idempotency (second run is a no-op) and scope-gate over HTTP.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { curate } from "../../src/core/curate.js";
import { curateTool } from "../../src/tools/curate.js";
import { authorize } from "../../src/auth/dispatcher.js";
import { ScopeDeniedError } from "../../src/auth/types.js";
import { _clearIndexCache } from "../../src/core/index.js";
import type { Runner } from "../../src/core/curate-git.js";

// ── Fixture constants ─────────────────────────────────────────────────────────

// A spec page with a merged-PR impl ref, but NO tags or related → PROMOTE_LANDED
// → to_status: active, flag_reason mentions tags+related
const SPEC_LANDED_ID = "spec-landed-plan";

// An idea draft with no inbound links, agent-authored, very old → ARCHIVE_STALE → archived
const STALE_AGENT_ID = "idea-stale-agent-orphan";

// An idea draft with no inbound links, human-authored, very old → ARCHIVE_STALE flagged (not archived)
const STALE_HUMAN_ID = "idea-stale-human-orphan";

// Page X is targeted by page Y's supersedes: link → X should become superseded
const SUPERSEDED_OLD_ID = "spec-old-design";
const SUPERSEDING_NEW_ID = "spec-new-design";

// A fake runner that always reports the PR as merged
const fakeMergedRunner: Runner = (_cmd: string, _args: string[]) => ({
  code: 0,
  stdout: "MERGED\n",
});

// ── Vault fixture helpers ─────────────────────────────────────────────────────

function makeVault(): string {
  const vault = mkdtempSync(join(tmpdir(), "stoa-integ-curate-"));
  mkdirSync(join(vault, "_index"), { recursive: true });
  writeFileSync(
    join(vault, "_index", "pages.json"),
    JSON.stringify({ pages: [] }),
  );
  writeFileSync(join(vault, "_index", "tokens.json"), JSON.stringify({}));
  writeFileSync(
    join(vault, "_index", "wikis.json"),
    JSON.stringify({ wikis: [] }),
  );
  writeFileSync(join(vault, "_index", "links.json"), JSON.stringify({}));
  return vault;
}

/**
 * Seed a page file and register it in pages.json + links.json.
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
    folder?: string;
    frontmatterExtra?: Record<string, unknown>;
    inbound?: string[];
  },
): void {
  const folder = opts.folder ?? `${opts.type}s`; // specs, ideas, concepts…
  const relPath = `wikis/${opts.wiki}/${folder}/${opts.id}.md`;
  const absDir = join(vault, "wikis", opts.wiki, folder);
  mkdirSync(absDir, { recursive: true });

  // Build frontmatter
  const fmParts: string[] = [
    `id: "${opts.id}"`,
    `title: "Test ${opts.id}"`,
    `type: ${opts.type}`,
    `wiki: ${opts.wiki}`,
    `status: ${opts.status}`,
    `created: "${opts.created}"`,
  ];
  if (opts.updated) fmParts.push(`updated: "${opts.updated}"`);
  if (opts.author) fmParts.push(`author: "${opts.author}"`);

  // Merge extra frontmatter fields (e.g. implementation, supersedes)
  const extra = opts.frontmatterExtra ?? {};
  for (const [k, v] of Object.entries(extra)) {
    fmParts.push(`${k}: ${JSON.stringify(v)}`);
  }

  writeFileSync(
    join(vault, relPath),
    `---\n${fmParts.join("\n")}\n---\npage body\n`,
  );

  // Register in pages.json
  const pagesPath = join(vault, "_index", "pages.json");
  const pagesData = JSON.parse(readFileSync(pagesPath, "utf8")) as {
    pages: unknown[];
  };
  pagesData.pages.push({
    id: opts.id,
    type: opts.type,
    wiki: opts.wiki,
    title: `Test ${opts.id}`,
    summary: "",
    tags: [],
    status: opts.status,
    updated: opts.updated ?? opts.created,
    created: opts.created,
    path: relPath,
  });
  writeFileSync(pagesPath, JSON.stringify(pagesData, null, 2));

  // Register inbound links
  if (opts.inbound && opts.inbound.length > 0) {
    const linksPath = join(vault, "_index", "links.json");
    const linksData = JSON.parse(readFileSync(linksPath, "utf8")) as Record<
      string,
      { outbound: string[]; inbound: string[] }
    >;
    linksData[opts.id] = { outbound: [], inbound: opts.inbound };
    writeFileSync(linksPath, JSON.stringify(linksData, null, 2));
  }
}

// ── Test state ────────────────────────────────────────────────────────────────

let vault: string;

beforeEach(() => {
  vault = makeVault();
  _clearIndexCache();

  // 1. PROMOTE_LANDED: spec with a merged-PR impl ref, NO tags/related
  //    → curate() will return to_status: "active" (APPLIED — not flagged).
  //    The missing fields are advisory only, carried in evidence as
  //    "eligible for accepted once <fields> added". No flag_reason is set.
  seedPage(vault, {
    id: SPEC_LANDED_ID,
    type: "spec",
    wiki: "_meta",
    status: "draft",
    created: "2024-01-15",
    updated: "2024-01-15",
    author: "human:tester",
    folder: "specs",
    frontmatterExtra: {
      implementation: [{ pr: "github.com/org/repo/pull/42" }],
    },
  });

  // 2. ARCHIVE_STALE (agent): stale orphan, no inbound links, agent-authored → applies:true
  seedPage(vault, {
    id: STALE_AGENT_ID,
    type: "idea",
    wiki: "_meta",
    status: "draft",
    created: "2020-01-01",
    updated: "2020-01-01",
    author: "agent:tester",
    folder: "ideas",
  });

  // 3. ARCHIVE_STALE (human): stale orphan, no inbound links, human-authored → gate blocks
  //    (auto_archive_human: false default) → flagged with flag_reason
  seedPage(vault, {
    id: STALE_HUMAN_ID,
    type: "idea",
    wiki: "_meta",
    status: "draft",
    created: "2020-06-01",
    updated: "2020-06-01",
    author: "human:tester",
    folder: "ideas",
  });

  // 4a. RESOLVE_SUPERSEDE: old page that will be superseded by the new page
  seedPage(vault, {
    id: SUPERSEDED_OLD_ID,
    type: "spec",
    wiki: "_meta",
    status: "active",
    created: "2023-01-01",
    updated: "2023-01-01",
    folder: "specs",
  });

  // 4b. RESOLVE_SUPERSEDE: new page that supersedes the old one
  seedPage(vault, {
    id: SUPERSEDING_NEW_ID,
    type: "spec",
    wiki: "_meta",
    status: "draft",
    created: "2024-06-01",
    updated: "2024-06-01",
    author: "human:tester",
    folder: "specs",
    frontmatterExtra: {
      supersedes: `[[${SUPERSEDED_OLD_ID}]]`,
    },
  });
});

afterEach(() => {
  try {
    rmSync(vault, { recursive: true, force: true });
  } catch {
    // ignore
  }
  _clearIndexCache();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("curate() — full fixture run (spec §6 acceptance criteria)", () => {
  it("PROMOTE_LANDED: merged-PR spec missing tags/related is APPLIED (active), advisory in evidence", async () => {
    const r = await curate(vault, "tester", {}, fakeMergedRunner);

    // With the new behavior the accepted-gap is advisory only.
    // No flag_reason is set, so the gate approves the action and it lands in `applied`.
    const landedAction = r.applied.find((a) => a.page_id === SPEC_LANDED_ID);
    expect(landedAction).toBeDefined();
    expect(landedAction!.to_status).toBe("active");
    expect(landedAction!.code).toBe("PROMOTE_LANDED");

    // flag_reason must be absent (advisory is in evidence, not blocking)
    expect(landedAction!.flag_reason).toBeUndefined();

    // evidence should mention the accepted-tier advisory
    expect(landedAction!.evidence).toMatch(/eligible for accepted/i);

    // Must NOT appear in flagged as a PROMOTE_LANDED action
    expect(
      r.flagged.some((a) => a.page_id === SPEC_LANDED_ID && a.code === "PROMOTE_LANDED"),
    ).toBe(false);

    // DISK-STATE: the file must now have status: active written to disk
    const pageFile = join(vault, "wikis/_meta/specs", `${SPEC_LANDED_ID}.md`);
    const raw = readFileSync(pageFile, "utf8");
    expect(raw).toContain("status: active");

    // Digest: PROMOTE_LANDED should appear in the Applied section, not Flagged
    const journalPath = join(
      vault,
      "wikis",
      "_meta",
      "journal",
      `${r.journal_id!}.md`,
    );
    const digest = readFileSync(journalPath, "utf8");
    // Applied section should contain the page id
    const appliedIdx = digest.indexOf("## Applied");
    const flaggedIdx = digest.indexOf("## Flagged");
    expect(appliedIdx).toBeGreaterThanOrEqual(0);
    const appliedSection = digest.slice(appliedIdx, flaggedIdx > appliedIdx ? flaggedIdx : undefined);
    expect(appliedSection).toContain(SPEC_LANDED_ID);
  });

  it("ARCHIVE_STALE (agent): stale agent-authored orphan is archived (applies:true)", async () => {
    const r = await curate(vault, "tester", {}, fakeMergedRunner);

    const archiveAction = r.applied.find(
      (a) => a.code === "ARCHIVE_STALE" && a.page_id === STALE_AGENT_ID,
    );
    expect(archiveAction).toBeDefined();
    expect(archiveAction!.to_status).toBe("archived");
    expect(archiveAction!.author_class).toBe("agent");

    // Verify the file on disk has status: archived
    const pageFile = join(
      vault,
      "wikis/_meta/ideas",
      `${STALE_AGENT_ID}.md`,
    );
    const raw = readFileSync(pageFile, "utf8");
    expect(raw).toContain("status: archived");
    expect(raw).toContain("archived_at");
  });

  it("ARCHIVE_STALE (human): stale human-authored orphan is flagged, not archived", async () => {
    const r = await curate(vault, "tester", {}, fakeMergedRunner);

    // Must NOT be in applied
    expect(
      r.applied.some((a) => a.page_id === STALE_HUMAN_ID),
    ).toBe(false);

    // Must be in flagged
    const flaggedAction = r.flagged.find(
      (a) => a.page_id === STALE_HUMAN_ID,
    );
    expect(flaggedAction).toBeDefined();
    expect(flaggedAction!.to_status).toBe("archived");
    expect(flaggedAction!.author_class).toBe("human");

    // File on disk must NOT be archived (gate held it back)
    const pageFile = join(
      vault,
      "wikis/_meta/ideas",
      `${STALE_HUMAN_ID}.md`,
    );
    const raw = readFileSync(pageFile, "utf8");
    expect(raw).not.toContain("status: archived");
  });

  it("RESOLVE_SUPERSEDE: page targeted by supersedes: link becomes superseded", async () => {
    const r = await curate(vault, "tester", {}, fakeMergedRunner);

    const supersedeAction = r.applied.find(
      (a) => a.code === "RESOLVE_SUPERSEDE" && a.page_id === SUPERSEDED_OLD_ID,
    );
    expect(supersedeAction).toBeDefined();
    expect(supersedeAction!.to_status).toBe("superseded");

    // Verify the file on disk has status: superseded
    const pageFile = join(
      vault,
      "wikis/_meta/specs",
      `${SUPERSEDED_OLD_ID}.md`,
    );
    const raw = readFileSync(pageFile, "utf8");
    expect(raw).toContain("status: superseded");
  });

  it("writes exactly one curation-run journal whose id ends -curation-run", async () => {
    const r = await curate(vault, "tester", {}, fakeMergedRunner);

    expect(r.journal_id).toBeDefined();
    expect(r.journal_id).toMatch(/-curation-run$/);

    const journalDir = join(vault, "wikis", "_meta", "journal");
    const journalPath = join(journalDir, `${r.journal_id!}.md`);
    expect(existsSync(journalPath)).toBe(true);

    const journalContent = readFileSync(journalPath, "utf8");
    // Digest must contain Applied and Flagged sections
    expect(journalContent).toContain("## Applied");
    expect(journalContent).toContain("## Flagged");

    // Exactly one curation-run file must exist in the journal directory
    const curationRunFiles = readdirSync(journalDir).filter((f) =>
      f.endsWith("-curation-run.md"),
    );
    expect(curationRunFiles).toHaveLength(1);
  });

  it("journal contains references to applied and flagged page ids", async () => {
    const r = await curate(vault, "tester", {}, fakeMergedRunner);

    const journalPath = join(
      vault,
      "wikis",
      "_meta",
      "journal",
      `${r.journal_id!}.md`,
    );
    const journalContent = readFileSync(journalPath, "utf8");

    // The stale agent page should appear in the applied section
    expect(journalContent).toContain(STALE_AGENT_ID);
    // The stale human page should appear in the flagged section
    expect(journalContent).toContain(STALE_HUMAN_ID);
  });
});

describe("curate() — idempotency (spec §6 AC5)", () => {
  it("second consecutive run applies no ARCHIVE_STALE or RESOLVE_SUPERSEDE actions", async () => {
    // First run — applies archive + supersede + promote-landed
    const first = await curate(vault, "tester", {}, fakeMergedRunner);
    expect(first.applied.length).toBeGreaterThan(0);

    // Clear index cache so second run reloads from disk
    _clearIndexCache();

    // Second run — previously archived and superseded pages are already at their
    // target status. PROMOTE_LANDED may re-fire for the active spec (active→active
    // is advisory-only), but no destructive ARCHIVE_STALE or RESOLVE_SUPERSEDE
    // changes should be applied a second time.
    const second = await curate(vault, "tester", {}, fakeMergedRunner);
    expect(
      second.applied.filter(
        (a) => a.code === "ARCHIVE_STALE" || a.code === "RESOLVE_SUPERSEDE",
      ),
    ).toHaveLength(0);
  });
});

describe("vault_curate scope gate (spec §6 AC6)", () => {
  it("authorize() throws ScopeDeniedError for HTTP principal without admin scope", () => {
    const httpNoAdmin = {
      agent_id: "outsider",
      scopes: ["vault_recall:wikis/*"],
      source: "http" as const,
    };
    expect(() => authorize(curateTool, {}, httpNoAdmin)).toThrow(
      ScopeDeniedError,
    );
  });

  it("authorize() allows HTTP principal with admin:* scope", () => {
    const httpAdmin = {
      agent_id: "ops",
      scopes: ["admin:*"],
      source: "http" as const,
    };
    expect(() => authorize(curateTool, {}, httpAdmin)).not.toThrow();
  });

  it("authorize() allows stdio principal without any admin scope (stdio is unrestricted)", () => {
    // stdio principals with '*:*' should pass regardless of adminOnly
    const stdio = {
      agent_id: "local",
      scopes: ["*:*"],
      source: "stdio" as const,
    };
    expect(() => authorize(curateTool, {}, stdio)).not.toThrow();
  });

  it("authorize() rejects HTTP principal with non-admin scopes", () => {
    const httpEmpty = {
      agent_id: "nobody",
      scopes: [],
      source: "http" as const,
    };
    expect(() => authorize(curateTool, {}, httpEmpty)).toThrow(ScopeDeniedError);
  });
});
