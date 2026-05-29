import { it, expect, beforeEach, afterEach } from "vitest";
import { curationRuleRegistry } from "../curation-rule.js";
import type { CandidatePage, CurationCtx, CurationAction } from "../curation-rule.js";

// ── Import the rule (side-effect: registers itself once at module load) ────
import "./promote-landed.js";

// ── Registry isolation ──────────────────────────────────────────────────────
// Capture the rule once (registered by the import above) and restore it after
// each test so bleed-in from other test files doesn't affect us. We use
// afterEach to remove any extra rules added by other imports, and beforeEach
// to ensure our rule is present.
let _promoteLandedRule: (typeof curationRuleRegistry)[number] | undefined;

beforeEach(() => {
  // Keep only the PROMOTE_LANDED rule for isolation.
  _promoteLandedRule = curationRuleRegistry.find(r => r.code === "PROMOTE_LANDED");
  curationRuleRegistry.length = 0;
  if (_promoteLandedRule) curationRuleRegistry.push(_promoteLandedRule);
});

afterEach(() => {
  // Leave registry clean after this suite.
  curationRuleRegistry.length = 0;
  if (_promoteLandedRule) curationRuleRegistry.push(_promoteLandedRule);
});

// ── Test helpers ────────────────────────────────────────────────────────────

function candidate(overrides: Partial<CandidatePage> & { frontmatter?: Record<string, unknown> }): CandidatePage {
  return {
    page_id: "spec-example",
    wiki: "test-wiki",
    type: "spec",
    path: "wikis/test-wiki/specs/spec-example.md",
    status: "active",
    author_class: "human",
    inbound_link_count: 0,
    frontmatter: {},
    ...overrides,
    ...(overrides.frontmatter ? { frontmatter: overrides.frontmatter } : {}),
  };
}

function makeCtx(
  candidates: CandidatePage[],
  verifyPrMerged: (ref: string) => "merged" | "open" | "unknown" = () => "unknown"
): CurationCtx {
  return {
    vaultPath: "/fake/vault",
    today: new Date("2026-05-29"),
    config: {
      archive_stale_days: 60,
      promote_active_recent_days: 14,
      confidence_floor: "medium",
      auto_archive_human: false,
      auto_commit: true,
    },
    candidates,
    verifyPrMerged,
  };
}

/** Run the registered rule and return the first (and usually only) action, or throw if none. */
function run1(
  candidates: CandidatePage[],
  verifyPrMerged?: (ref: string) => "merged" | "open" | "unknown"
): CurationAction {
  const rule = curationRuleRegistry.find(r => r.code === "PROMOTE_LANDED");
  if (!rule) throw new Error("PROMOTE_LANDED rule not registered");
  const actions = rule.run(makeCtx(candidates, verifyPrMerged));
  if (actions.length === 0) throw new Error("Expected at least one action but got none");
  return actions[0];
}

/** Run and return all actions. */
function runAll(
  candidates: CandidatePage[],
  verifyPrMerged?: (ref: string) => "merged" | "open" | "unknown"
): CurationAction[] {
  const rule = curationRuleRegistry.find(r => r.code === "PROMOTE_LANDED");
  if (!rule) throw new Error("PROMOTE_LANDED rule not registered");
  return rule.run(makeCtx(candidates, verifyPrMerged));
}

// ── Core acceptance-criteria tests ─────────────────────────────────────────

it("merged-PR spec with tags+related → accepted, high confidence", () => {
  const c = candidate({
    type: "spec",
    frontmatter: {
      implementation: [{ pr: "github.com/o/n/pull/1" }],
      tags: ["x"],
      related: ["[[wikis/test-wiki/concepts/concept-foo]]"],
    },
  });
  const a = run1([c], () => "merged");
  expect(a).toMatchObject({ to_status: "accepted", confidence: "high" });
});

it("merged-PR plan with tags+related → accepted, high confidence", () => {
  const c = candidate({
    type: "spec", // using spec as plan is not a canonical NoteType
    page_id: "spec-plan-like",
    frontmatter: {
      implementation: [{ pr: "github.com/o/n/pull/1" }],
      tags: ["x"],
      related: ["[[y]]"],
    },
  });
  const a = run1([c], () => "merged");
  expect(a).toMatchObject({ to_status: "accepted", confidence: "high" });
});

it("merged-PR spec missing tags → active, no flag_reason, advisory in evidence", () => {
  const c = candidate({
    type: "spec",
    status: "draft",
    frontmatter: {
      implementation: [{ pr: "github.com/o/n/pull/1" }],
      related: ["[[y]]"],
    },
  });
  const a = run1([c], () => "merged");
  expect(a.to_status).toBe("active");
  expect(a.flag_reason).toBeUndefined();
  expect(a.evidence).toMatch(/tags/);
  expect(a.evidence).toMatch(/eligible for accepted/);
});

it("merged-PR spec missing related → active, no flag_reason, advisory in evidence", () => {
  const c = candidate({
    type: "spec",
    status: "draft",
    frontmatter: {
      implementation: [{ pr: "github.com/o/n/pull/1" }],
      tags: ["x"],
    },
  });
  const a = run1([c], () => "merged");
  expect(a.to_status).toBe("active");
  expect(a.flag_reason).toBeUndefined();
  expect(a.evidence).toMatch(/related/);
  expect(a.evidence).toMatch(/eligible for accepted/);
});

it("merged-PR spec missing both tags and related → active, no flag_reason, advisory in evidence lists both", () => {
  const c = candidate({
    type: "spec",
    status: "draft",
    frontmatter: {
      implementation: [{ pr: "github.com/o/n/pull/1" }],
    },
  });
  const a = run1([c], () => "merged");
  expect(a.to_status).toBe("active");
  expect(a.flag_reason).toBeUndefined();
  expect(a.evidence).toMatch(/tags/);
  expect(a.evidence).toMatch(/related/);
  expect(a.evidence).toMatch(/eligible for accepted/);
});

it("merged-PR decision missing confidence → active, no flag_reason, advisory in evidence", () => {
  const c = candidate({
    type: "decision",
    status: "draft",
    frontmatter: {
      implementation: [{ pr: "github.com/o/n/pull/1" }],
      tags: ["x"],
      related: ["[[y]]"],
    },
  });
  const a = run1([c], () => "merged");
  expect(a.to_status).toBe("active");
  expect(a.flag_reason).toBeUndefined();
  expect(a.evidence).toMatch(/confidence/);
  expect(a.evidence).toMatch(/eligible for accepted/);
});

it("verifyPrMerged returning open → no action", () => {
  const c = candidate({
    type: "spec",
    frontmatter: {
      implementation: [{ pr: "github.com/o/n/pull/1" }],
      tags: ["x"],
      related: ["[[y]]"],
    },
  });
  const actions = runAll([c], () => "open");
  expect(actions).toHaveLength(0);
});

it("verifyPrMerged returning unknown → no action (unverifiable)", () => {
  const c = candidate({
    type: "spec",
    frontmatter: {
      implementation: [{ pr: "github.com/o/n/pull/1" }],
      tags: ["x"],
      related: ["[[y]]"],
    },
  });
  const actions = runAll([c], () => "unknown");
  expect(actions).toHaveLength(0);
});

it("no PR and no related tasks → no action", () => {
  const c = candidate({
    type: "spec",
    frontmatter: { tags: ["x"], related: ["[[y]]"] },
  });
  const actions = runAll([c], () => "unknown");
  expect(actions).toHaveLength(0);
});

it("all related task candidates done → medium confidence", () => {
  const taskDone = candidate({
    page_id: "task-foo",
    type: "task",
    status: "done",
    frontmatter: {},
  });
  const c = candidate({
    type: "spec",
    frontmatter: {
      tags: ["x"],
      related: ["[[wikis/test-wiki/tasks/task-foo]]"],
    },
  });
  const a = run1([c, taskDone], () => "unknown");
  expect(a.confidence).toBe("medium");
});

it("related task candidate in 'completed' status also qualifies", () => {
  const taskDone = candidate({
    page_id: "task-bar",
    type: "task",
    status: "completed",
    frontmatter: {},
  });
  const c = candidate({
    type: "spec",
    frontmatter: {
      tags: ["x"],
      related: ["[[wikis/test-wiki/tasks/task-bar]]"],
    },
  });
  const a = run1([c, taskDone], () => "unknown");
  expect(a.confidence).toBe("medium");
});

it("related task still active → no action", () => {
  const taskActive = candidate({
    page_id: "task-active",
    type: "task",
    status: "active",
    frontmatter: {},
  });
  const c = candidate({
    type: "spec",
    frontmatter: {
      related: ["[[wikis/test-wiki/tasks/task-active]]"],
    },
  });
  const actions = runAll([c, taskActive], () => "unknown");
  expect(actions).toHaveLength(0);
});

it("related has no task candidates (only non-task) → no medium action", () => {
  const concept = candidate({
    page_id: "concept-foo",
    type: "concept",
    status: "active",
    frontmatter: {},
  });
  const c = candidate({
    type: "spec",
    frontmatter: {
      related: ["[[wikis/test-wiki/concepts/concept-foo]]"],
    },
  });
  const actions = runAll([c, concept], () => "unknown");
  expect(actions).toHaveLength(0);
});

it("only spec and decision types are considered — concept is skipped", () => {
  const c = candidate({
    type: "concept",
    frontmatter: {
      implementation: [{ pr: "github.com/o/n/pull/1" }],
      tags: ["x"],
      related: ["[[y]]"],
    },
  });
  const actions = runAll([c], () => "merged");
  expect(actions).toHaveLength(0);
});

it("idea type is skipped", () => {
  const c = candidate({
    type: "idea",
    frontmatter: {
      implementation: [{ pr: "github.com/o/n/pull/1" }],
      tags: ["x"],
      related: ["[[y]]"],
    },
  });
  const actions = runAll([c], () => "merged");
  expect(actions).toHaveLength(0);
});

it("decision with confidence, tags, related → accepted, high", () => {
  const c = candidate({
    type: "decision",
    frontmatter: {
      implementation: [{ pr: "github.com/o/n/pull/1" }],
      tags: ["x"],
      related: ["[[y]]"],
      confidence: "high",
    },
  });
  const a = run1([c], () => "merged");
  expect(a.to_status).toBe("accepted");
  expect(a.confidence).toBe("high");
});

it("action carries from_status matching candidate status", () => {
  const c = candidate({
    type: "spec",
    status: "draft",
    frontmatter: {
      implementation: [{ pr: "github.com/o/n/pull/1" }],
      tags: ["x"],
      related: ["[[y]]"],
    },
  });
  const a = run1([c], () => "merged");
  expect(a.from_status).toBe("draft");
});

it("action code is PROMOTE_LANDED", () => {
  const c = candidate({
    type: "spec",
    frontmatter: {
      implementation: [{ pr: "github.com/o/n/pull/1" }],
      tags: ["x"],
      related: ["[[y]]"],
    },
  });
  const a = run1([c], () => "merged");
  expect(a.code).toBe("PROMOTE_LANDED");
});

it("empty implementation array → no action", () => {
  const c = candidate({
    type: "spec",
    frontmatter: {
      implementation: [],
      tags: ["x"],
      related: ["[[y]]"],
    },
  });
  const actions = runAll([c], () => "merged");
  expect(actions).toHaveLength(0);
});

it("implementation with no pr field → no action when verifyPrMerged would return merged", () => {
  const c = candidate({
    type: "spec",
    frontmatter: {
      implementation: [{ repo: "github.com/o/n" }],
      tags: ["x"],
      related: ["[[y]]"],
    },
  });
  const actions = runAll([c], () => "merged");
  expect(actions).toHaveLength(0);
});

it("mixed related: some task done, some task active → no action (not all done)", () => {
  const taskDone = candidate({ page_id: "task-done", type: "task", status: "done", frontmatter: {} });
  const taskActive = candidate({ page_id: "task-active", type: "task", status: "active", frontmatter: {} });
  const c = candidate({
    type: "spec",
    frontmatter: {
      related: [
        "[[wikis/test-wiki/tasks/task-done]]",
        "[[wikis/test-wiki/tasks/task-active]]",
      ],
    },
  });
  const actions = runAll([c, taskDone, taskActive], () => "unknown");
  expect(actions).toHaveLength(0);
});

// ── Idempotency tests ───────────────────────────────────────────────────────

it("idempotency: active spec with merged PR but missing tags+related → NO action (already at target)", () => {
  // This is the core idempotency bug: a page already at "active" that would
  // compute to_status="active" (because accepted fields missing) must NOT
  // re-emit the action on subsequent curate runs.
  const c = candidate({
    type: "spec",
    status: "active",
    frontmatter: {
      implementation: [{ pr: "github.com/o/n/pull/1" }],
      // missing tags and related → target is "active"
    },
  });
  const actions = runAll([c], () => "merged");
  expect(actions).toHaveLength(0);
});

it("idempotency: active plan/spec with merged PR but missing related → NO action", () => {
  const c = candidate({
    type: "spec",
    status: "active",
    frontmatter: {
      implementation: [{ pr: "github.com/o/n/pull/1" }],
      tags: ["x"],
      // missing related → target is "active"
    },
  });
  const actions = runAll([c], () => "merged");
  expect(actions).toHaveLength(0);
});

it("idempotency: active spec with merged PR and full accepted fields → emits active→accepted (still promotes)", () => {
  // Even though it's already active, it has all accepted fields now,
  // so to_status="accepted" ≠ current "active" → action IS emitted.
  const c = candidate({
    type: "spec",
    status: "active",
    frontmatter: {
      implementation: [{ pr: "github.com/o/n/pull/1" }],
      tags: ["x"],
      related: ["[[y]]"],
    },
  });
  const a = run1([c], () => "merged");
  expect(a.from_status).toBe("active");
  expect(a.to_status).toBe("accepted");
});
