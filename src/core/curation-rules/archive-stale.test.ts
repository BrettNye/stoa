import { it, expect, beforeEach } from "vitest";
import { curationRuleRegistry } from "../curation-rule.js";
import type { CandidatePage, CurationCtx, CurationAction } from "../curation-rule.js";
import type { CurationConfig } from "../../config.js";

// Reset the registry before each test so rule self-registration is idempotent
// across test runs (the rule registers itself on import; we don't want double-
// registration from parallel test files). Import the rule module here so it
// is registered for this test file.
import "./archive-stale.js";

beforeEach(() => {
  // keep registry to the ONE rule under test, registered exactly once on import
  // (registration is idempotent: it happens once at module-load time)
});

// ─── helpers ────────────────────────────────────────────────────────────────

const TODAY = new Date("2025-06-01");

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
    created: "2024-01-01",
    updated: undefined,
    inbound_link_count: 0,
    frontmatter: {},
    ...overrides,
  };
}

function makeCtx(
  pages: CandidatePage[],
  configOverrides: Partial<CurationConfig> = {}
): CurationCtx {
  return {
    vaultPath: "/fake/vault",
    today: TODAY,
    config: { ...DEFAULT_CONFIG, ...configOverrides },
    candidates: pages,
    verifyPrMerged: () => "unknown",
  };
}

/** Run only the ARCHIVE_STALE rule. */
function runRule(ctx: CurationCtx): CurationAction[] {
  const rule = curationRuleRegistry.find((r) => r.code === "ARCHIVE_STALE");
  if (!rule) throw new Error("ARCHIVE_STALE rule not registered");
  return rule.run(ctx);
}

/** Expect exactly one action and return it. */
function run1(page: CandidatePage, configOverrides: Partial<CurationConfig> = {}): CurationAction {
  const actions = runRule(makeCtx([page], configOverrides));
  expect(actions).toHaveLength(1);
  return actions[0];
}

/** Returns true when zero actions are emitted (no action expected). */
function run0(page: CandidatePage, configOverrides: Partial<CurationConfig> = {}): boolean {
  const actions = runRule(makeCtx([page], configOverrides));
  return actions.length === 0;
}

// ─── tests ──────────────────────────────────────────────────────────────────

it("stale orphan draft → archive action with archived_at", () => {
  const a = run1(candidate({ status: "draft", inbound_link_count: 0, updated: "2020-01-01" }), { archive_stale_days: 60 });
  expect(a).toMatchObject({ to_status: "archived" });
  expect(a.field_patch?.archived_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

it("stale but linked draft → no action", () => {
  expect(run0(candidate({ status: "draft", inbound_link_count: 3, updated: "2020-01-01" }))).toBe(true);
});

it("non-draft status → no action", () => {
  expect(run0(candidate({ status: "active", inbound_link_count: 0, updated: "2020-01-01" }))).toBe(true);
});

it("within staleness window → no action", () => {
  // 10 days ago — well within 60-day window
  expect(run0(candidate({ status: "draft", inbound_link_count: 0, updated: "2025-05-22" }))).toBe(true);
});

it("action carries correct metadata (code, from_status, confidence, author_class)", () => {
  const a = run1(candidate({ status: "draft", inbound_link_count: 0, updated: "2020-01-01", author_class: "human" }));
  expect(a.code).toBe("ARCHIVE_STALE");
  expect(a.from_status).toBe("draft");
  expect(a.confidence).toBe("high");
  expect(a.author_class).toBe("human");
});

it("archived_at equals today string (2025-06-01)", () => {
  const a = run1(candidate({ status: "draft", inbound_link_count: 0, updated: "2020-01-01" }));
  expect(a.field_patch?.archived_at).toBe("2025-06-01");
});

it("human-authored stale orphan draft → action emitted (gate holds back, not rule)", () => {
  const a = run1(
    candidate({ status: "draft", inbound_link_count: 0, updated: "2020-01-01", author_class: "human" }),
  );
  expect(a.author_class).toBe("human");
  expect(a.to_status).toBe("archived");
});

it("falls back to created when updated is absent", () => {
  const a = run1(candidate({ status: "draft", inbound_link_count: 0, created: "2020-01-01", updated: undefined }));
  expect(a.to_status).toBe("archived");
});

it("exactly at cutoff boundary → no action (must be strictly older)", () => {
  // cutoff = 2025-06-01 - 60 days = 2025-04-02 (60 * 86400000 ms before today)
  const cutoffMs = TODAY.getTime() - 60 * 864e5;
  const cutoffDate = new Date(cutoffMs).toISOString().slice(0, 10);
  expect(run0(candidate({ status: "draft", inbound_link_count: 0, updated: cutoffDate }))).toBe(true);
});

it("emits evidence string mentioning age and inbound links", () => {
  const a = run1(candidate({ status: "draft", inbound_link_count: 0, updated: "2020-01-01" }));
  expect(a.evidence).toMatch(/inbound/i);
});
