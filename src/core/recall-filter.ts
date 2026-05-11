import type { IndexedPage } from "./index.js";

export interface FilterPair {
  attr: string;
  // For scalar/list equality: the literal value.
  // For date comparison: structured shape.
  value: string | DateComparison;
}

export interface DateComparison {
  comparator: "<" | ">" | "=";
  // Resolved at evaluation time relative to `now`.
  // "relative" form: { kind: "relative", days: 60 } → 60 days ago.
  // "absolute" form: { kind: "absolute", iso: "2026-01-01" } → exact ISO date.
  // "quarter" form: { kind: "quarter", year: 2026, q: 2 } → start of 2026 Q2.
  reference:
    | { kind: "relative"; days: number }
    | { kind: "absolute"; iso: string }
    | { kind: "quarter"; year: number; q: 1 | 2 | 3 | 4 };
}

export interface FilterExpr {
  pairs: FilterPair[]; // Implicit AND across the array.
}

export class FilterParseError extends Error {
  constructor(
    message: string,
    public position: number
  ) {
    super(message);
    this.name = "FilterParseError";
  }
}

// Date fields the evaluator knows to compare numerically.
const DATE_FIELDS = new Set(["updated", "created"]);
// List fields the evaluator knows to apply contains-semantics to.
const LIST_FIELDS = new Set(["tags"]);

// Regex for relative date: <60d  >7d  =30d
const RELATIVE_DATE_RE = /^([<>=])(\d+)d$/;
// Regex for absolute date: <2026-01-01  >2026-01-01  =2026-01-01
const ABSOLUTE_DATE_RE = /^([<>=])(\d{4}-\d{2}-\d{2})$/;
// Regex for quarter: =2026q2  =2026q1  (lowercase only — uppercase Q is not supported)
const QUARTER_DATE_RE = /^([<>=])(\d{4})q([1-4])$/;

// Called only when `raw` is known to start with a comparator character.
function parseDateValue(raw: string, position: number): DateComparison {
  const relMatch = RELATIVE_DATE_RE.exec(raw);
  if (relMatch) {
    return {
      comparator: relMatch[1] as "<" | ">" | "=",
      reference: { kind: "relative", days: parseInt(relMatch[2], 10) }
    };
  }

  const quarterMatch = QUARTER_DATE_RE.exec(raw);
  if (quarterMatch) {
    const q = parseInt(quarterMatch[3], 10) as 1 | 2 | 3 | 4;
    return {
      comparator: quarterMatch[1] as "<" | ">" | "=",
      reference: { kind: "quarter", year: parseInt(quarterMatch[2], 10), q }
    };
  }

  const absMatch = ABSOLUTE_DATE_RE.exec(raw);
  if (absMatch) {
    return {
      comparator: absMatch[1] as "<" | ">" | "=",
      reference: { kind: "absolute", iso: absMatch[2] }
    };
  }

  // Has a comparator prefix but doesn't match any known date format.
  throw new FilterParseError(
    `Unrecognized date comparison format: "${raw}". Expected formats: <60d, >2026-01-01, =2026q2`,
    position
  );
}

export function parseFilter(expr: string): FilterExpr {
  if (!expr || expr.trim() === "") {
    throw new FilterParseError("Filter expression must not be empty", 0);
  }

  const rawPairs = expr.split(",");
  const pairs: FilterPair[] = [];
  let charOffset = 0;

  for (const raw of rawPairs) {
    const colonIdx = raw.indexOf(":");
    if (colonIdx === -1) {
      throw new FilterParseError(
        `Malformed filter pair "${raw}": missing ":" separator. Expected format attr:value`,
        charOffset
      );
    }

    const attr = raw.slice(0, colonIdx).trim();
    const valueRaw = raw.slice(colonIdx + 1).trim();

    if (!attr) {
      throw new FilterParseError(
        `Malformed filter pair "${raw}": attribute name must not be empty`,
        charOffset
      );
    }
    if (!valueRaw) {
      throw new FilterParseError(
        `Malformed filter pair "${raw}": value must not be empty`,
        charOffset + colonIdx + 1
      );
    }

    const first = valueRaw[0];

    if (DATE_FIELDS.has(attr)) {
      // Date fields require a comparator prefix (<, >, or =).
      if (first !== "<" && first !== ">" && first !== "=") {
        throw new FilterParseError(
          `date field '${attr}' requires a comparator (<, >, or =); got '${valueRaw}'`,
          charOffset + colonIdx + 1
        );
      }
      // parseDateValue will throw if the format is unrecognized.
      const dateCmp = parseDateValue(valueRaw, charOffset + colonIdx + 1);
      pairs.push({ attr, value: dateCmp });
      charOffset += raw.length + 1; // +1 for the comma
      continue;
    }

    // Non-date field: store as scalar value for equality/list matching.
    pairs.push({ attr, value: valueRaw });
    charOffset += raw.length + 1; // +1 for the comma
  }

  return { pairs };
}

export function evaluateFilter(
  filter: FilterExpr,
  page: IndexedPage,
  now: Date = new Date()
): boolean {
  for (const pair of filter.pairs) {
    if (DATE_FIELDS.has(pair.attr)) {
      const pageDate = (page as unknown as Record<string, unknown>)[pair.attr];
      if (typeof pageDate !== "string" || !pageDate) return false;
      if (typeof pair.value !== "object") return false;
      if (!compareDate(pageDate, pair.value as DateComparison, now)) return false;
    } else if (LIST_FIELDS.has(pair.attr)) {
      const list = (page as unknown as Record<string, unknown>)[pair.attr];
      if (!Array.isArray(list)) return false;
      if (typeof pair.value !== "string") return false;
      if (!list.includes(pair.value)) return false;
    } else {
      // Scalar equality. Lookup field on IndexedPage by name.
      const field = (page as unknown as Record<string, unknown>)[pair.attr];
      if (typeof pair.value !== "string") return false;
      // Missing field → no-match
      if (field === undefined || field === null) return false;
      if (field !== pair.value) return false;
    }
  }
  return true;
}

function quarterBounds(year: number, q: 1 | 2 | 3 | 4): { start: string; end: string } {
  // Quarter months (1-indexed):
  // Q1: Jan-Mar (01-03), Q2: Apr-Jun (04-06), Q3: Jul-Sep (07-09), Q4: Oct-Dec (10-12)
  const startMonths: Record<number, string> = { 1: "01", 2: "04", 3: "07", 4: "10" };
  const endMonths: Record<number, string> = { 1: "03", 2: "06", 3: "09", 4: "12" };
  const endDays: Record<number, string> = { 1: "31", 2: "30", 3: "30", 4: "31" };
  const y = String(year);
  return {
    start: `${y}-${startMonths[q]}-01`,
    end: `${y}-${endMonths[q]}-${endDays[q]}`
  };
}

function compareDate(pageDateIso: string, cmp: DateComparison, now: Date): boolean {
  // Normalize page date to YYYY-MM-DD prefix for comparison (handles ISO datetimes too).
  const pageDate = pageDateIso.slice(0, 10);

  const ref = cmp.reference;

  if (ref.kind === "relative") {
    // `<60d` means "older than 60 days ago" — page date is MORE than 60 days in the past.
    // Threshold = now - days.
    const thresholdDate = new Date(now);
    thresholdDate.setDate(thresholdDate.getDate() - ref.days);
    const thresholdIso = thresholdDate.toISOString().slice(0, 10);

    if (cmp.comparator === "<") {
      // Older than threshold = page date is strictly before threshold
      return pageDate < thresholdIso;
    } else if (cmp.comparator === ">") {
      // Newer than threshold = page date is strictly after threshold
      return pageDate > thresholdIso;
    } else {
      // = means exactly at threshold date
      return pageDate === thresholdIso;
    }
  } else if (ref.kind === "absolute") {
    const refIso = ref.iso;
    if (cmp.comparator === "<") {
      return pageDate < refIso;
    } else if (cmp.comparator === ">") {
      return pageDate > refIso;
    } else {
      return pageDate === refIso;
    }
  } else {
    // quarter
    const bounds = quarterBounds(ref.year, ref.q);
    if (cmp.comparator === "=") {
      return pageDate >= bounds.start && pageDate <= bounds.end;
    } else if (cmp.comparator === "<") {
      return pageDate < bounds.start;
    } else {
      return pageDate > bounds.end;
    }
  }
}
