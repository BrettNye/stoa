import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCandidates } from "./curation-candidates.js";
import type { VaultIndex } from "./index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVault(): string {
  const vault = mkdtempSync(join(tmpdir(), "stoa-cand-"));
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

function makeIdx(
  pages: VaultIndex["pages"],
  links: VaultIndex["links"] = {}
): VaultIndex {
  return { wikis: [], pages, links };
}

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const DRAFT_AGENT_PATH = "wikis/alpha/idea/idea-bot-draft.md";
const ACTIVE_HUMAN_PATH = "wikis/alpha/concept/concept-foo.md";
const ACCEPTED_PATH = "wikis/alpha/spec/spec-stable.md";
const ACTIVE_QUESTION_PATH = "wikis/alpha/question/question-active.md";
const MALFORMED_PATH = "wikis/alpha/idea/idea-bad.md";
const MISSING_PATH = "wikis/alpha/idea/idea-missing.md";
const OTHER_WIKI_PATH = "wikis/beta/concept/concept-beta.md";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("loadCandidates", () => {
  let vault: string;

  beforeEach(() => {
    vault = makeVault();

    // draft, agent-authored
    writePage(vault, DRAFT_AGENT_PATH, {
      id: "idea-bot-draft",
      title: "Bot Draft",
      type: "idea",
      wiki: "alpha",
      status: "draft",
      created: "2026-01-01",
      author: "agent:charmander",
    });

    // active, human-authored, has 2 inbound links
    writePage(vault, ACTIVE_HUMAN_PATH, {
      id: "concept-foo",
      title: "Foo",
      type: "concept",
      wiki: "alpha",
      status: "active",
      created: "2026-01-02",
      updated: "2026-01-10",
    });

    // accepted — should be excluded
    writePage(vault, ACCEPTED_PATH, {
      id: "spec-stable",
      title: "Stable Spec",
      type: "spec",
      wiki: "alpha",
      status: "accepted",
      created: "2026-01-01",
    });

    // active question — verifies question-typed pages are included when active
    writePage(vault, ACTIVE_QUESTION_PATH, {
      id: "question-active",
      title: "Active Question",
      type: "question",
      wiki: "alpha",
      status: "active",
      created: "2026-01-03",
    });

    // malformed (no frontmatter)
    mkdirSync(join(vault, "wikis/alpha/idea"), { recursive: true });
    writeFileSync(join(vault, MALFORMED_PATH), "no frontmatter here\n");

    // other wiki
    writePage(vault, OTHER_WIKI_PATH, {
      id: "concept-beta",
      title: "Beta Concept",
      type: "concept",
      wiki: "beta",
      status: "draft",
      created: "2026-01-01",
    });
  });

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
  });

  it("includes only draft/active pages — excludes accepted; question type included when active", () => {
    const idx = makeIdx([
      { id: "idea-bot-draft", wiki: "alpha", type: "idea", status: "draft", path: DRAFT_AGENT_PATH, title: "", summary: "", tags: [], updated: "", created: "" },
      { id: "concept-foo", wiki: "alpha", type: "concept", status: "active", path: ACTIVE_HUMAN_PATH, title: "", summary: "", tags: [], updated: "", created: "" },
      { id: "spec-stable", wiki: "alpha", type: "spec", status: "accepted", path: ACCEPTED_PATH, title: "", summary: "", tags: [], updated: "", created: "" },
      { id: "question-active", wiki: "alpha", type: "question", status: "active", path: ACTIVE_QUESTION_PATH, title: "", summary: "", tags: [], updated: "", created: "" },
    ]);
    const cands = loadCandidates(vault, idx);
    const statuses = cands.map(c => c.status);
    expect(statuses).not.toContain("accepted");
    expect(statuses.every(s => ["draft", "active"].includes(s))).toBe(true);
    expect(cands.map(c => c.page_id)).toContain("idea-bot-draft");
    expect(cands.map(c => c.page_id)).toContain("concept-foo");
    expect(cands.map(c => c.page_id)).toContain("question-active");
    // question type IS included when status is active
    expect(cands.find(c => c.page_id === "question-active")?.type).toBe("question");
  });

  it("classifies agent author correctly", () => {
    const idx = makeIdx([
      { id: "idea-bot-draft", wiki: "alpha", type: "idea", status: "draft", path: DRAFT_AGENT_PATH, title: "", summary: "", tags: [], updated: "", created: "" },
      { id: "concept-foo", wiki: "alpha", type: "concept", status: "active", path: ACTIVE_HUMAN_PATH, title: "", summary: "", tags: [], updated: "", created: "" },
    ]);
    const cands = loadCandidates(vault, idx);
    const bot = cands.find(c => c.page_id === "idea-bot-draft")!;
    const human = cands.find(c => c.page_id === "concept-foo")!;
    expect(bot.author_class).toBe("agent");
    expect(human.author_class).toBe("human");
  });

  it("absent author field defaults to human", () => {
    const idx = makeIdx([
      { id: "concept-foo", wiki: "alpha", type: "concept", status: "active", path: ACTIVE_HUMAN_PATH, title: "", summary: "", tags: [], updated: "", created: "" },
    ]);
    const cands = loadCandidates(vault, idx);
    expect(cands[0].author_class).toBe("human");
  });

  it("inbound_link_count reflects idx.links inbound array length", () => {
    const idx = makeIdx(
      [
        { id: "concept-foo", wiki: "alpha", type: "concept", status: "active", path: ACTIVE_HUMAN_PATH, title: "", summary: "", tags: [], updated: "", created: "" },
        { id: "idea-bot-draft", wiki: "alpha", type: "idea", status: "draft", path: DRAFT_AGENT_PATH, title: "", summary: "", tags: [], updated: "", created: "" },
      ],
      {
        "concept-foo": { outbound: [], inbound: ["page-a", "page-b"] },
      }
    );
    const cands = loadCandidates(vault, idx);
    const foo = cands.find(c => c.page_id === "concept-foo")!;
    const bot = cands.find(c => c.page_id === "idea-bot-draft")!;
    expect(foo.inbound_link_count).toBe(2);
    expect(bot.inbound_link_count).toBe(0); // not in links → 0
  });

  it("skips pages whose file is missing from disk", () => {
    const idx = makeIdx([
      { id: "idea-missing", wiki: "alpha", type: "idea", status: "draft", path: MISSING_PATH, title: "", summary: "", tags: [], updated: "", created: "" },
      { id: "concept-foo", wiki: "alpha", type: "concept", status: "active", path: ACTIVE_HUMAN_PATH, title: "", summary: "", tags: [], updated: "", created: "" },
    ]);
    const cands = loadCandidates(vault, idx);
    expect(cands.map(c => c.page_id)).not.toContain("idea-missing");
    expect(cands.map(c => c.page_id)).toContain("concept-foo");
  });

  it("skips pages with malformed frontmatter without throwing", () => {
    const idx = makeIdx([
      { id: "idea-bad", wiki: "alpha", type: "idea", status: "draft", path: MALFORMED_PATH, title: "", summary: "", tags: [], updated: "", created: "" },
      { id: "concept-foo", wiki: "alpha", type: "concept", status: "active", path: ACTIVE_HUMAN_PATH, title: "", summary: "", tags: [], updated: "", created: "" },
    ]);
    expect(() => loadCandidates(vault, idx)).not.toThrow();
    const cands = loadCandidates(vault, idx);
    expect(cands.map(c => c.page_id)).not.toContain("idea-bad");
    expect(cands.map(c => c.page_id)).toContain("concept-foo");
  });

  it("filters by wiki when wiki argument is provided", () => {
    const idx = makeIdx([
      { id: "idea-bot-draft", wiki: "alpha", type: "idea", status: "draft", path: DRAFT_AGENT_PATH, title: "", summary: "", tags: [], updated: "", created: "" },
      { id: "concept-beta", wiki: "beta", type: "concept", status: "draft", path: OTHER_WIKI_PATH, title: "", summary: "", tags: [], updated: "", created: "" },
    ]);
    const cands = loadCandidates(vault, idx, "alpha");
    expect(cands.map(c => c.wiki)).toEqual(["alpha"]);
    expect(cands.map(c => c.page_id)).not.toContain("concept-beta");
  });

  it("returns all eligible wikis when wiki argument is omitted", () => {
    const idx = makeIdx([
      { id: "idea-bot-draft", wiki: "alpha", type: "idea", status: "draft", path: DRAFT_AGENT_PATH, title: "", summary: "", tags: [], updated: "", created: "" },
      { id: "concept-beta", wiki: "beta", type: "concept", status: "draft", path: OTHER_WIKI_PATH, title: "", summary: "", tags: [], updated: "", created: "" },
    ]);
    const cands = loadCandidates(vault, idx);
    const wikis = new Set(cands.map(c => c.wiki));
    expect(wikis.has("alpha")).toBe(true);
    expect(wikis.has("beta")).toBe(true);
  });

  it("exposes created and updated from frontmatter", () => {
    const idx = makeIdx([
      { id: "concept-foo", wiki: "alpha", type: "concept", status: "active", path: ACTIVE_HUMAN_PATH, title: "", summary: "", tags: [], updated: "", created: "" },
    ]);
    const cands = loadCandidates(vault, idx);
    expect(cands[0].created).toBe("2026-01-02");
    expect(cands[0].updated).toBe("2026-01-10");
  });

  it("exposes full frontmatter on each candidate", () => {
    const idx = makeIdx([
      { id: "idea-bot-draft", wiki: "alpha", type: "idea", status: "draft", path: DRAFT_AGENT_PATH, title: "", summary: "", tags: [], updated: "", created: "" },
    ]);
    const cands = loadCandidates(vault, idx);
    expect(cands[0].frontmatter).toBeDefined();
    expect(cands[0].frontmatter.title).toBe("Bot Draft");
  });
});
