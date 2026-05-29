import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { composeCurationDigest, writeCurationDigest } from "./curate-journal.js";
import type { CurationAction } from "./curation-rule.js";

// ─── composeCurationDigest (pure) ─────────────────────────────────────────────

describe("composeCurationDigest", () => {
  it("groups applied actions under ### <CODE> headings with from → to — evidence bullets", () => {
    const applied: CurationAction[] = [
      { code: "PROMOTE_LANDED", page_id: "p1", wiki: "w", from_status: "draft",
        to_status: "active", evidence: "PR merged", confidence: "high", author_class: "agent" },
    ];
    const body = composeCurationDigest(applied, []);
    expect(body).toContain("### PROMOTE_LANDED");
    expect(body).toContain("[[p1]] draft → active — PR merged");
  });

  it("lists flagged actions under 'Flagged — not applied' with flag_reason", () => {
    const flagged: CurationAction[] = [
      { code: "ARCHIVE_STALE", page_id: "q", wiki: "w", from_status: "draft",
        to_status: "archived", evidence: "60d", confidence: "medium", author_class: "human",
        flag_reason: "human-authored" },
    ];
    const body = composeCurationDigest([], flagged);
    expect(body).toContain("Flagged — not applied");
    expect(body).toContain("[[q]] → archived: human-authored");
  });

  it("renders _none_ for empty applied list", () => {
    const body = composeCurationDigest([], []);
    expect(body).toContain("## Applied");
    expect(body).toMatch(/## Applied\s+_none_/);
  });

  it("renders _none_ for empty flagged list", () => {
    const body = composeCurationDigest([], []);
    expect(body).toMatch(/Flagged — not applied\s+_none_/);
  });

  it("groups multiple applied actions of the same code under one heading", () => {
    const applied: CurationAction[] = [
      { code: "PROMOTE_LANDED", page_id: "a", wiki: "w", from_status: "draft",
        to_status: "active", evidence: "ev1", confidence: "high", author_class: "agent" },
      { code: "PROMOTE_LANDED", page_id: "b", wiki: "w", from_status: "draft",
        to_status: "active", evidence: "ev2", confidence: "high", author_class: "agent" },
    ];
    const body = composeCurationDigest(applied, []);
    // heading appears exactly once
    expect(body.match(/### PROMOTE_LANDED/g)?.length).toBe(1);
    expect(body).toContain("[[a]] draft → active — ev1");
    expect(body).toContain("[[b]] draft → active — ev2");
  });

  it("separates distinct codes into separate ### sections", () => {
    const applied: CurationAction[] = [
      { code: "PROMOTE_LANDED", page_id: "x", wiki: "w", from_status: "draft",
        to_status: "active", evidence: "ev1", confidence: "high", author_class: "agent" },
      { code: "ARCHIVE_STALE", page_id: "y", wiki: "w", from_status: "draft",
        to_status: "archived", evidence: "ev2", confidence: "medium", author_class: "agent" },
    ];
    const body = composeCurationDigest(applied, []);
    expect(body).toContain("### PROMOTE_LANDED");
    expect(body).toContain("### ARCHIVE_STALE");
  });

  it("never throws on empty input", () => {
    expect(() => composeCurationDigest([], [])).not.toThrow();
  });
});

// ─── writeCurationDigest (I/O) ─────────────────────────────────────────────────

describe("writeCurationDigest", () => {
  const tmpDirs: string[] = [];

  function makeVault(): string {
    const vault = mkdtempSync(join(tmpdir(), "stoa-test-vault-"));
    tmpDirs.push(vault);
    // Minimal index files so upsertPage doesn't fail on missing sidecars
    const indexDir = join(vault, "_index");
    mkdirSync(indexDir, { recursive: true });
    const pages: any[] = [];
    const tokens: Record<string, any> = {};
    const wikis: Record<string, any> = {};
    const links: Record<string, any> = {};
    writeFileSync(join(indexDir, "pages.json"), JSON.stringify(pages));
    writeFileSync(join(indexDir, "tokens.json"), JSON.stringify(tokens));
    writeFileSync(join(indexDir, "wikis.json"), JSON.stringify(wikis));
    writeFileSync(join(indexDir, "links.json"), JSON.stringify(links));
    // Wiki journal dir created by writeCurationDigest itself
    return vault;
  }

  afterEach(() => {
    for (const d of tmpDirs) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    tmpDirs.length = 0;
  });

  it("writes a journal file whose id ends with -curation-run", async () => {
    const vault = makeVault();
    const id = await writeCurationDigest(vault, "test-wiki", "agent-x", [], []);
    expect(id).toMatch(/-curation-run$/);
  });

  it("creates the journal directory and writes the file", async () => {
    const vault = makeVault();
    const id = await writeCurationDigest(vault, "test-wiki", "agent-x", [], []);
    const filePath = join(vault, "wikis", "test-wiki", "journal", `${id}.md`);
    expect(existsSync(filePath)).toBe(true);
  });

  it("written file has type: journal and author: agent:<id>", async () => {
    const vault = makeVault();
    const id = await writeCurationDigest(vault, "test-wiki", "agent-y", [], []);
    const filePath = join(vault, "wikis", "test-wiki", "journal", `${id}.md`);
    const raw = readFileSync(filePath, "utf8");
    expect(raw).toContain("type: journal");
    // gray-matter quotes values containing colons, so the serialized form is
    // either  author: 'agent:agent-y'  or  author: "agent:agent-y"
    expect(raw).toMatch(/author:\s+['"]?agent:agent-y['"]?/);
  });

  it("digest body is embedded in the written file", async () => {
    const vault = makeVault();
    const applied: CurationAction[] = [
      { code: "PROMOTE_LANDED", page_id: "p99", wiki: "test-wiki",
        from_status: "draft", to_status: "active", evidence: "PR merged",
        confidence: "high", author_class: "agent" },
    ];
    const id = await writeCurationDigest(vault, "test-wiki", "agent-z", applied, []);
    const filePath = join(vault, "wikis", "test-wiki", "journal", `${id}.md`);
    const raw = readFileSync(filePath, "utf8");
    expect(raw).toContain("### PROMOTE_LANDED");
    expect(raw).toContain("[[p99]]");
  });
});
