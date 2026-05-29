import { it, expect, beforeEach } from "vitest";
import { curationRuleRegistry } from "../curation-rule.js";
import type { CandidatePage, CurationCtx, CurationAction } from "../curation-rule.js";
import type { CurationConfig } from "../../config.js";
// Side-effect import: registers the PROMOTE_ACTIVE rule into curationRuleRegistry
import "./promote-active.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const TODAY = new Date("2026-05-29");
const RECENT_DATE = "2026-05-20"; // 9 days ago — within default 14-day window
const STALE_DATE = "2026-04-01";  // 58 days ago — outside 14-day window

const BASE_CONFIG: CurationConfig = {
  archive_stale_days: 60,
  promote_active_recent_days: 14,
  confidence_floor: "medium",
  auto_archive_human: false,
  auto_commit: true,
};

function candidate(overrides: Partial<CandidatePage>): CandidatePage {
  return {
    page_id: "idea-test",
    wiki: "alpha",
    type: "idea",
    path: "wikis/alpha/idea/idea-test.md",
    status: "draft",
    author_class: "human",
    inbound_link_count: 0,
    frontmatter: {},
    ...overrides,
  };
}

function makeCtx(candidates: CandidatePage[]): CurationCtx {
  return {
    vaultPath: "/fake/vault",
    today: TODAY,
    config: BASE_CONFIG,
    candidates,
    verifyPrMerged: () => "unknown",
  };
}

function getRule() {
  const rule = curationRuleRegistry.find(r => r.code === "PROMOTE_ACTIVE");
  if (!rule) throw new Error("PROMOTE_ACTIVE rule not found in registry");
  return rule;
}

/** Run the rule against a single candidate and return the single action (or throw if not exactly 1) */
function run1(c: CandidatePage): CurationAction {
  const rule = getRule();
  const ctx = makeCtx([c]);
  const actions = rule.run(ctx);
  if (actions.length !== 1) throw new Error(`Expected 1 action, got ${actions.length}`);
  return actions[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests — acceptance criteria from spec §4.2 / task body
// ─────────────────────────────────────────────────────────────────────────────

it("linked draft with summary → active action with medium confidence", () => {
  const a = run1(candidate({ status: "draft", inbound_link_count: 2, frontmatter: { summary: "some summary" } }));
  expect(a).toMatchObject({ to_status: "active", confidence: "medium" });
});

it("linked draft missing summary → flag_reason mentions summary", () => {
  const a = run1(candidate({ status: "draft", inbound_link_count: 2, frontmatter: {} }));
  expect(a.flag_reason).toMatch(/summary/);
});

it("linked draft missing summary → action still produced (gate holds it back, not this rule)", () => {
  const a = run1(candidate({ status: "draft", inbound_link_count: 1, frontmatter: {} }));
  expect(a.to_status).toBe("active");
});

it("recently edited draft with no links → action with evidence 'edited recently'", () => {
  const a = run1(candidate({ status: "draft", inbound_link_count: 0, updated: RECENT_DATE, frontmatter: { summary: "s" } }));
  expect(a.evidence).toBe("edited recently");
  expect(a.to_status).toBe("active");
});

it("draft with neither inbound links nor recent edit → no action", () => {
  const rule = getRule();
  const ctx = makeCtx([candidate({ status: "draft", inbound_link_count: 0, updated: STALE_DATE })]);
  expect(rule.run(ctx)).toHaveLength(0);
});

it("draft with no inbound links and no updated field → no action", () => {
  const rule = getRule();
  const ctx = makeCtx([candidate({ status: "draft", inbound_link_count: 0, updated: undefined })]);
  expect(rule.run(ctx)).toHaveLength(0);
});

it("non-draft page → no action", () => {
  const rule = getRule();
  const ctx = makeCtx([candidate({ status: "active", inbound_link_count: 5, frontmatter: { summary: "s" } })]);
  expect(rule.run(ctx)).toHaveLength(0);
});

it("linked draft → evidence string includes inbound link count", () => {
  const a = run1(candidate({ status: "draft", inbound_link_count: 3, frontmatter: { summary: "s" } }));
  expect(a.evidence).toMatch(/3/);
  expect(a.evidence).toMatch(/inbound/);
});

it("linked draft → action code is PROMOTE_ACTIVE", () => {
  const a = run1(candidate({ status: "draft", inbound_link_count: 1, frontmatter: { summary: "s" } }));
  expect(a.code).toBe("PROMOTE_ACTIVE");
});

it("action preserves page_id and wiki", () => {
  const a = run1(candidate({ page_id: "idea-foo", wiki: "my-wiki", status: "draft", inbound_link_count: 1, frontmatter: { summary: "s" } }));
  expect(a.page_id).toBe("idea-foo");
  expect(a.wiki).toBe("my-wiki");
});

it("recently edited draft — boundary: updated exactly at cutoff is included", () => {
  // cutoff = today - 14 days = 2026-05-15; 14 * 864e5 ms = 1,209,600,000 ms
  // TODAY = 2026-05-29 00:00:00 UTC; cutoff = 2026-05-15 00:00:00 UTC
  const cutoffDate = "2026-05-15";
  const rule = getRule();
  const ctx = makeCtx([candidate({ status: "draft", inbound_link_count: 0, updated: cutoffDate, frontmatter: { summary: "s" } })]);
  const actions = rule.run(ctx);
  expect(actions).toHaveLength(1);
  expect(actions[0].evidence).toBe("edited recently");
});

it("inbound link takes evidence priority over recent edit when both are present", () => {
  const a = run1(candidate({ status: "draft", inbound_link_count: 2, updated: RECENT_DATE, frontmatter: { summary: "s" } }));
  expect(a.evidence).toMatch(/inbound/);
});

it("empty string summary → flag_reason set (empty summary counts as missing)", () => {
  const a = run1(candidate({ status: "draft", inbound_link_count: 1, frontmatter: { summary: "  " } }));
  expect(a.flag_reason).toMatch(/summary/);
});

it("action from_status is draft", () => {
  const a = run1(candidate({ status: "draft", inbound_link_count: 1, frontmatter: { summary: "s" } }));
  expect(a.from_status).toBe("draft");
});
