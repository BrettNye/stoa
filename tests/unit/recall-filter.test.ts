import { describe, it, expect } from "vitest";
import { parseFilter, evaluateFilter, FilterParseError } from "../../src/core/recall-filter.js";
import type { IndexedPage } from "../../src/core/index.js";

const makePage = (overrides: Partial<IndexedPage>): IndexedPage => ({
  id: "concept-x", type: "concept", wiki: "meetings", title: "X", summary: "",
  tags: [], status: "active", updated: "2026-05-11", created: "2026-05-11",
  path: "wikis/meetings/concepts/concept-x.md",
  ...overrides
});

describe("parseFilter", () => {
  it("parses a single scalar pair", () => {
    const expr = parseFilter("type:decision");
    expect(expr.pairs).toEqual([{ attr: "type", value: "decision" }]);
  });

  it("parses multiple comma-separated pairs", () => {
    const expr = parseFilter("type:decision,tags:customer,status:active");
    expect(expr.pairs).toHaveLength(3);
    expect(expr.pairs[0]).toEqual({ attr: "type", value: "decision" });
    expect(expr.pairs[1]).toEqual({ attr: "tags", value: "customer" });
    expect(expr.pairs[2]).toEqual({ attr: "status", value: "active" });
  });

  it("parses a relative date comparison (<60d)", () => {
    const expr = parseFilter("updated:<60d");
    expect(expr.pairs).toHaveLength(1);
    const pair = expr.pairs[0];
    expect(pair.attr).toBe("updated");
    expect(typeof pair.value).toBe("object");
    const dc = pair.value as { comparator: string; reference: unknown };
    expect(dc.comparator).toBe("<");
    expect(dc.reference).toEqual({ kind: "relative", days: 60 });
  });

  it("parses an absolute date comparison (>2026-01-01)", () => {
    const expr = parseFilter("created:>2026-01-01");
    expect(expr.pairs).toHaveLength(1);
    const pair = expr.pairs[0];
    expect(pair.attr).toBe("created");
    const dc = pair.value as { comparator: string; reference: unknown };
    expect(dc.comparator).toBe(">");
    expect(dc.reference).toEqual({ kind: "absolute", iso: "2026-01-01" });
  });

  it("parses a quarter date comparison (=2026q2)", () => {
    const expr = parseFilter("created:=2026q2");
    expect(expr.pairs).toHaveLength(1);
    const pair = expr.pairs[0];
    expect(pair.attr).toBe("created");
    const dc = pair.value as { comparator: string; reference: unknown };
    expect(dc.comparator).toBe("=");
    expect(dc.reference).toEqual({ kind: "quarter", year: 2026, q: 2 });
  });

  it("rejects empty input", () => {
    expect(() => parseFilter("")).toThrow(FilterParseError);
  });

  it("rejects pair with no colon (no value)", () => {
    expect(() => parseFilter("type")).toThrow(FilterParseError);
  });

  it("rejects pair with empty attr", () => {
    expect(() => parseFilter(":value")).toThrow(FilterParseError);
  });

  it("rejects pair with empty value", () => {
    expect(() => parseFilter("type:")).toThrow(FilterParseError);
  });

  it("throws FilterParseError with position for malformed input", () => {
    let err: FilterParseError | null = null;
    try {
      parseFilter("type");
    } catch (e) {
      err = e as FilterParseError;
    }
    expect(err).not.toBeNull();
    expect(err).toBeInstanceOf(FilterParseError);
    expect(typeof err!.position).toBe("number");
  });

  it("throws FilterParseError when a date field has a plain scalar value (no comparator)", () => {
    expect(() => parseFilter("updated:2026-05-01")).toThrow(FilterParseError);
  });

  it("includes the field name and value in the error message for date-without-comparator", () => {
    let err: FilterParseError | null = null;
    try {
      parseFilter("updated:2026-05-01");
    } catch (e) {
      err = e as FilterParseError;
    }
    expect(err).not.toBeNull();
    expect(err!.message).toContain("updated");
    expect(err!.message).toContain("2026-05-01");
    expect(err!.message).toContain("comparator");
  });

  it("throws FilterParseError when created field has a plain scalar value (no comparator)", () => {
    expect(() => parseFilter("created:2026-01-01")).toThrow(FilterParseError);
  });
});

describe("evaluateFilter — type-aware semantics", () => {
  it("scalar equality on type — match", () => {
    const expr = parseFilter("type:decision");
    expect(evaluateFilter(expr, makePage({ type: "decision" }))).toBe(true);
  });

  it("scalar equality on type — no match", () => {
    const expr = parseFilter("type:decision");
    expect(evaluateFilter(expr, makePage({ type: "concept" }))).toBe(false);
  });

  it("list contains on tags — match", () => {
    const expr = parseFilter("tags:customer");
    expect(evaluateFilter(expr, makePage({ tags: ["customer", "company-x"] }))).toBe(true);
  });

  it("list contains on tags — no match", () => {
    const expr = parseFilter("tags:customer");
    expect(evaluateFilter(expr, makePage({ tags: ["prospect"] }))).toBe(false);
  });

  it("list contains — empty tags returns false", () => {
    const expr = parseFilter("tags:customer");
    expect(evaluateFilter(expr, makePage({ tags: [] }))).toBe(false);
  });

  it("multiple pairs are ANDed — all match", () => {
    const expr = parseFilter("type:decision,status:active");
    expect(evaluateFilter(expr, makePage({ type: "decision", status: "active" }))).toBe(true);
  });

  it("multiple pairs are ANDed — one fails", () => {
    const expr = parseFilter("type:decision,status:active");
    expect(evaluateFilter(expr, makePage({ type: "decision", status: "draft" }))).toBe(false);
  });

  it("missing attribute on page returns false", () => {
    const expr = parseFilter("nonexistent:value");
    expect(evaluateFilter(expr, makePage({}))).toBe(false);
  });

  it("tag matching is case-sensitive", () => {
    const expr = parseFilter("tags:Customer");
    expect(evaluateFilter(expr, makePage({ tags: ["customer"] }))).toBe(false);
  });

  it("scalar equality on status — match", () => {
    const expr = parseFilter("status:active");
    expect(evaluateFilter(expr, makePage({ status: "active" }))).toBe(true);
  });

  it("scalar equality on wiki — match", () => {
    const expr = parseFilter("wiki:meetings");
    expect(evaluateFilter(expr, makePage({ wiki: "meetings" }))).toBe(true);
  });
});

describe("evaluateFilter — date comparisons", () => {
  // `updated:<60d` should match pages updated MORE than 60 days ago (older than threshold)
  it("date relative <60d — page older than 60 days matches", () => {
    const expr = parseFilter("updated:<60d");
    const now = new Date("2026-05-11T00:00:00Z");
    // 61 days before now: 2026-03-11
    const page = makePage({ updated: "2026-03-10" });
    expect(evaluateFilter(expr, page, now)).toBe(true);
  });

  it("date relative <60d — page within 60 days does not match", () => {
    const expr = parseFilter("updated:<60d");
    const now = new Date("2026-05-11T00:00:00Z");
    // 10 days before now: 2026-05-01
    const page = makePage({ updated: "2026-05-01" });
    expect(evaluateFilter(expr, page, now)).toBe(false);
  });

  it("date relative <60d — page exactly 60 days ago does not match", () => {
    const expr = parseFilter("updated:<60d");
    const now = new Date("2026-05-11T00:00:00Z");
    // exactly 60 days before: 2026-03-12
    const page = makePage({ updated: "2026-03-12" });
    expect(evaluateFilter(expr, page, now)).toBe(false);
  });

  it("date absolute >2026-01-01 — page after reference matches", () => {
    const expr = parseFilter("created:>2026-01-01");
    const page = makePage({ created: "2026-06-01" });
    expect(evaluateFilter(expr, page, new Date())).toBe(true);
  });

  it("date absolute >2026-01-01 — page before reference does not match", () => {
    const expr = parseFilter("created:>2026-01-01");
    const page = makePage({ created: "2025-12-31" });
    expect(evaluateFilter(expr, page, new Date())).toBe(false);
  });

  it("date absolute >2026-01-01 — page on reference date does not match (strict)", () => {
    const expr = parseFilter("created:>2026-01-01");
    const page = makePage({ created: "2026-01-01" });
    expect(evaluateFilter(expr, page, new Date())).toBe(false);
  });

  it("date quarter =2026q2 — page in Q2 (April) matches", () => {
    const expr = parseFilter("created:=2026q2");
    const page = makePage({ created: "2026-04-15" });
    expect(evaluateFilter(expr, page, new Date())).toBe(true);
  });

  it("date quarter =2026q2 — page in Q2 (June 30) matches", () => {
    const expr = parseFilter("created:=2026q2");
    const page = makePage({ created: "2026-06-30" });
    expect(evaluateFilter(expr, page, new Date())).toBe(true);
  });

  it("date quarter =2026q2 — page in Q1 does not match", () => {
    const expr = parseFilter("created:=2026q2");
    const page = makePage({ created: "2026-03-31" });
    expect(evaluateFilter(expr, page, new Date())).toBe(false);
  });

  it("date quarter =2026q2 — page in Q3 does not match", () => {
    const expr = parseFilter("created:=2026q2");
    const page = makePage({ created: "2026-07-01" });
    expect(evaluateFilter(expr, page, new Date())).toBe(false);
  });

  it("date quarter =2026q1 — Jan 1 matches", () => {
    const expr = parseFilter("created:=2026q1");
    const page = makePage({ created: "2026-01-01" });
    expect(evaluateFilter(expr, page, new Date())).toBe(true);
  });

  it("date quarter =2026q4 — Dec 31 matches", () => {
    const expr = parseFilter("created:=2026q4");
    const page = makePage({ created: "2026-12-31" });
    expect(evaluateFilter(expr, page, new Date())).toBe(true);
  });

  it("date field missing on page returns false", () => {
    const expr = parseFilter("updated:<60d");
    // Cast to force missing field
    const page = makePage({ updated: "" });
    const now = new Date("2026-05-11T00:00:00Z");
    expect(evaluateFilter(expr, page, now)).toBe(false);
  });

  it("now defaults to current date (smoke test — just doesn't throw)", () => {
    const expr = parseFilter("updated:<60d");
    const page = makePage({ updated: "2020-01-01" });
    expect(() => evaluateFilter(expr, page)).not.toThrow();
    expect(evaluateFilter(expr, page)).toBe(true);
  });
});
