import { it, expect } from "vitest";
import { curationRuleRegistry } from "../curation-rule.js";
import type { CandidatePage, CurationCtx, CurationAction } from "../curation-rule.js";
import type { CurationConfig } from "../../config.js";

// Import the rule module so it self-registers
import "./resolve-supersede.js";

// ─── helpers ────────────────────────────────────────────────────────────────

const TODAY = new Date("2026-05-29");

const DEFAULT_CONFIG: CurationConfig = {
  archive_stale_days: 60,
  promote_active_recent_days: 14,
  confidence_floor: "medium",
  auto_archive_human: false,
  auto_commit: true,
};

function candidate(overrides: Partial<CandidatePage>): CandidatePage {
  return {
    page_id: "idea-test",
    wiki: "test-wiki",
    type: "idea",
    path: "wikis/test-wiki/idea/idea-test.md",
    status: "draft",
    author_class: "agent",
    created: "2026-01-01",
    updated: undefined,
    inbound_link_count: 0,
    frontmatter: {},
    ...overrides,
  };
}

function makeCtx(pages: CandidatePage[]): CurationCtx {
  return {
    vaultPath: "/fake/vault",
    today: TODAY,
    config: DEFAULT_CONFIG,
    candidates: pages,
    verifyPrMerged: () => "unknown",
  };
}

/** Run only the RESOLVE_SUPERSEDE rule. */
function runRule(cands: CandidatePage[]): CurationAction[] {
  const rule = curationRuleRegistry.find((r) => r.code === "RESOLVE_SUPERSEDE");
  if (!rule) throw new Error("RESOLVE_SUPERSEDE rule not registered");
  return rule.run(makeCtx(cands));
}

/** Shorthand: run all candidates and return all actions. */
function runAll(cands: CandidatePage[]): CurationAction[] {
  return runRule(cands);
}

// ─── tests ──────────────────────────────────────────────────────────────────

// AC1: page targeted by supersedes: link → superseded action with field_patch
it("page targeted by a supersedes: link → superseded action", () => {
  const cands = [
    candidate({ page_id: "decision-old", status: "accepted" }),
    candidate({ page_id: "decision-new", frontmatter: { supersedes: "[[decision-old]]" } }),
  ];
  const a = runAll(cands).find((x) => x.page_id === "decision-old");
  expect(a).toMatchObject({ to_status: "superseded" });
  expect(a!.field_patch?.superseded_by).toBe("[[decision-new]]");
});

// AC1 (array form): supersedes: can be an array of wikilinks
it("supersedes array form → superseded action for each target", () => {
  const cands = [
    candidate({ page_id: "spec-a", status: "active" }),
    candidate({ page_id: "spec-b", status: "active" }),
    candidate({
      page_id: "spec-new",
      frontmatter: { supersedes: ["[[spec-a]]", "[[spec-b]]"] },
    }),
  ];
  const actions = runAll(cands);
  const a = actions.find((x) => x.page_id === "spec-a");
  const b = actions.find((x) => x.page_id === "spec-b");
  expect(a).toMatchObject({ to_status: "superseded" });
  expect(a!.field_patch?.superseded_by).toBe("[[spec-new]]");
  expect(b).toMatchObject({ to_status: "superseded" });
  expect(b!.field_patch?.superseded_by).toBe("[[spec-new]]");
});

// AC3: already-superseded page → no action (idempotent)
it("already superseded page → no action", () => {
  const cands = [
    candidate({ page_id: "decision-old", status: "superseded" }),
    candidate({ page_id: "decision-new", frontmatter: { supersedes: "[[decision-old]]" } }),
  ];
  const actions = runAll(cands);
  expect(actions.find((x) => x.page_id === "decision-old")).toBeUndefined();
});

// AC2: question with resolved_by: set and status ≠ archived → archived action with resolved_at
it("question with resolved_by: set → archived action with resolved_at", () => {
  const cands = [
    candidate({
      page_id: "question-foo",
      type: "question",
      status: "active",
      frontmatter: { resolved_by: "[[decision-bar]]" },
    }),
  ];
  const actions = runAll(cands);
  expect(actions).toHaveLength(1);
  expect(actions[0]).toMatchObject({
    page_id: "question-foo",
    to_status: "archived",
    code: "RESOLVE_SUPERSEDE",
    confidence: "high",
  });
  expect(actions[0].field_patch?.resolved_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

// AC3: already-archived question → no action (idempotent)
it("already archived question → no action", () => {
  const cands = [
    candidate({
      page_id: "question-foo",
      type: "question",
      status: "archived",
      frontmatter: { resolved_by: "[[decision-bar]]" },
    }),
  ];
  const actions = runAll(cands);
  expect(actions).toHaveLength(0);
});

// AC4: no action from related: adjacency only (no fuzzy inference)
it("related: link does NOT trigger supersede action", () => {
  const cands = [
    candidate({ page_id: "decision-old", status: "active", frontmatter: { related: ["[[decision-new]]"] } }),
    candidate({ page_id: "decision-new", status: "active", frontmatter: { related: ["[[decision-old]]"] } }),
  ];
  const actions = runAll(cands);
  expect(actions).toHaveLength(0);
});

// covers path-prefix stripping (e.g. [[wikis/some-wiki/decision/decision-old]])
it("wikilink with vault-root path prefix → still resolves target", () => {
  const cands = [
    candidate({ page_id: "decision-old", status: "active" }),
    candidate({
      page_id: "decision-new",
      frontmatter: { supersedes: "[[wikis/my-wiki/decision/decision-old]]" },
    }),
  ];
  const a = runAll(cands).find((x) => x.page_id === "decision-old");
  expect(a).toMatchObject({ to_status: "superseded" });
});

// covers alias stripping (e.g. [[decision-old|Old Decision]])
it("wikilink with alias → still resolves target", () => {
  const cands = [
    candidate({ page_id: "decision-old", status: "active" }),
    candidate({
      page_id: "decision-new",
      frontmatter: { supersedes: "[[decision-old|Old Decision]]" },
    }),
  ];
  const a = runAll(cands).find((x) => x.page_id === "decision-old");
  expect(a).toMatchObject({ to_status: "superseded" });
});

// action metadata: code, from_status, confidence, author_class
it("action carries correct metadata", () => {
  const cands = [
    candidate({ page_id: "decision-old", status: "accepted", author_class: "human" }),
    candidate({ page_id: "decision-new", frontmatter: { supersedes: "[[decision-old]]" } }),
  ];
  const a = runAll(cands).find((x) => x.page_id === "decision-old")!;
  expect(a.code).toBe("RESOLVE_SUPERSEDE");
  expect(a.from_status).toBe("accepted");
  expect(a.confidence).toBe("high");
  expect(a.author_class).toBe("human");
  expect(a.wiki).toBe("test-wiki");
});

// evidence string should mention the superseding page
it("evidence string mentions the superseding page id", () => {
  const cands = [
    candidate({ page_id: "decision-old", status: "active" }),
    candidate({ page_id: "decision-new", frontmatter: { supersedes: "[[decision-old]]" } }),
  ];
  const a = runAll(cands).find((x) => x.page_id === "decision-old")!;
  expect(a.evidence).toMatch(/decision-new/);
});

// wikilink with .md suffix → strip it
it("wikilink with .md suffix → still resolves target", () => {
  const cands = [
    candidate({ page_id: "decision-old", status: "active" }),
    candidate({
      page_id: "decision-new",
      frontmatter: { supersedes: "[[decision-old.md]]" },
    }),
  ];
  const a = runAll(cands).find((x) => x.page_id === "decision-old");
  expect(a).toMatchObject({ to_status: "superseded" });
});
