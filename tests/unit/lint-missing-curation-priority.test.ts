// Tests for the MISSING_CURATION_PRIORITY lint rule.
//
// Fires on `status: draft` + `author: agent:*` pages aged > N days with no
// `curation_priority` frontmatter annotation. Pure helper
// `findMissingCurationPriority(candidates, today, stalenessDays)` is exercised
// here with synthetic candidate stubs; integration with the registry is
// exercised separately.
//
// Plan reference: wikis/_meta/plans/2026-05-08-substrate-adoption-quickwin.md
// §W1.3.

import { describe, it, expect } from "vitest";
import {
  findMissingCurationPriority,
  MISSING_CURATION_PRIORITY_CODE,
  DEFAULT_STALENESS_DAYS,
} from "../../src/core/lint-checks/missing-curation-priority.js";
import { lintCheckRegistry } from "../../src/core/lint-check.js";
import "../../src/core/lint-checks/missing-curation-priority.js";

interface Candidate {
  pageId: string;
  wiki: string;
  filePath: string;
  fmCreated: string | undefined;
  fmAuthor: string | undefined;
  fmCurationPriority: unknown;
}

function candidate(overrides: Partial<Candidate>): Candidate {
  return {
    pageId: "idea-x",
    wiki: "test-wiki",
    filePath: "<test:idea-x>",
    fmCreated: "2026-04-01", // old enough to fire
    fmAuthor: "agent:bulbasaur",
    fmCurationPriority: undefined,
    ...overrides,
  };
}

const TODAY = new Date("2026-05-08T00:00:00Z");

describe("findMissingCurationPriority (pure helper)", () => {
  it("flags an agent-authored draft aged > 7 days with no priority", () => {
    const out = findMissingCurationPriority(
      [candidate({})], // 37 days old, agent author, no priority
      TODAY,
    );
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe("warning");
    expect(out[0].code).toBe(MISSING_CURATION_PRIORITY_CODE);
    expect(out[0].page_id).toBe("idea-x");
    expect(out[0].message).toContain("37 day");
  });

  it("does NOT flag human-authored drafts", () => {
    const out = findMissingCurationPriority(
      [candidate({ fmAuthor: "human:brett" })],
      TODAY,
    );
    expect(out).toHaveLength(0);
  });

  it("does NOT flag drafts younger than the threshold", () => {
    const out = findMissingCurationPriority(
      [candidate({ fmCreated: "2026-05-05" })], // 3 days old
      TODAY,
    );
    expect(out).toHaveLength(0);
  });

  it("does NOT flag drafts that already have a valid curation_priority", () => {
    expect(findMissingCurationPriority([candidate({ fmCurationPriority: "high" })], TODAY)).toHaveLength(0);
    expect(findMissingCurationPriority([candidate({ fmCurationPriority: "medium" })], TODAY)).toHaveLength(0);
    expect(findMissingCurationPriority([candidate({ fmCurationPriority: "low" })], TODAY)).toHaveLength(0);
  });

  it("DOES flag drafts with an invalid curation_priority value", () => {
    // Invalid values are treated as "missing" — forces correction.
    const out = findMissingCurationPriority(
      [candidate({ fmCurationPriority: "urgent" })],
      TODAY,
    );
    expect(out).toHaveLength(1);
  });

  it("does NOT flag pages without an author field at all", () => {
    const out = findMissingCurationPriority(
      [candidate({ fmAuthor: undefined })],
      TODAY,
    );
    expect(out).toHaveLength(0);
  });

  it("respects custom staleness threshold", () => {
    const c = candidate({ fmCreated: "2026-04-30" }); // 8 days old
    expect(findMissingCurationPriority([c], TODAY, 7)).toHaveLength(1);
    expect(findMissingCurationPriority([c], TODAY, 14)).toHaveLength(0);
  });

  it("skips pages with malformed created dates", () => {
    const out = findMissingCurationPriority(
      [candidate({ fmCreated: "not-a-date" })],
      TODAY,
    );
    expect(out).toHaveLength(0);
  });

  it("emits a suggestion mentioning the curation_priority annotation", () => {
    const out = findMissingCurationPriority([candidate({})], TODAY);
    expect(out[0].suggestion).toContain("curation_priority");
  });

  it("handles multiple candidates independently", () => {
    const out = findMissingCurationPriority(
      [
        candidate({ pageId: "idea-flagged" }),
        candidate({ pageId: "idea-priority-set", fmCurationPriority: "high" }),
        candidate({ pageId: "idea-too-young", fmCreated: "2026-05-05" }),
        candidate({ pageId: "idea-human", fmAuthor: "human:brett" }),
      ],
      TODAY,
    );
    expect(out.map(d => d.page_id)).toEqual(["idea-flagged"]);
  });
});

describe("MISSING_CURATION_PRIORITY registered LintCheck", () => {
  it("registers under code MISSING_CURATION_PRIORITY", () => {
    const reg = lintCheckRegistry.find(c => c.code === MISSING_CURATION_PRIORITY_CODE);
    expect(reg).toBeDefined();
  });
});

describe("DEFAULT_STALENESS_DAYS constant", () => {
  it("is 7 by default", () => {
    expect(DEFAULT_STALENESS_DAYS).toBe(7);
  });
});
