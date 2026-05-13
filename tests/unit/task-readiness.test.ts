import { describe, it, expect } from "vitest";
import { checkTaskReadiness } from "../../src/core/task-readiness.js";

describe("checkTaskReadiness", () => {
  it("returns ready when all four signals present", () => {
    const body = [
      "Touches `src/foo.ts:42`.",
      "**Scope:** numbered steps.",
      "**Out of scope:** unrelated cleanup.",
      "**Acceptance criteria:** tests pass.",
    ].join("\n\n");
    expect(checkTaskReadiness(body)).toEqual({ ready: true });
  });

  it("returns not-ready listing each missing signal", () => {
    const body = "A one-line body with no paths or sections.";
    const r = checkTaskReadiness(body);
    expect(r.ready).toBe(false);
    if (!r.ready) {
      expect(r.missing.sort()).toEqual(["files", "out_of_scope", "scope", "verification"]);
    }
  });

  it("returns all four missing for empty body", () => {
    const r = checkTaskReadiness("");
    expect(r.ready).toBe(false);
    if (!r.ready) {
      expect(r.missing.sort()).toEqual(["files", "out_of_scope", "scope", "verification"]);
    }
  });

  // Scope signal fixtures
  it("scope signal via **Diagnose end-to-end (foo):** heading (matches)", () => {
    const body = [
      "Touches `src/foo.ts`.",
      "**Diagnose end-to-end (foo):** do the thing.",
      "**Out of scope:** nothing.",
      "**Acceptance criteria:** passes.",
    ].join("\n\n");
    const r = checkTaskReadiness(body);
    expect(r.ready).toBe(true);
  });

  it("scope signal via **Backend (charmeleon scope):** heading (matches by keyword anywhere in span)", () => {
    const body = [
      "Touches `src/bar.ts`.",
      "**Backend (charmeleon scope):** implementation details.",
      "**Out of scope:** nothing.",
      "**Acceptance criteria:** passes.",
    ].join("\n\n");
    const r = checkTaskReadiness(body);
    expect(r.ready).toBe(true);
  });

  it("scope signal via Requirements: line start (matches)", () => {
    const body = [
      "Touches `src/baz.ts`.",
      "Requirements: must do X.",
      "**Out of scope:** nothing.",
      "**Acceptance criteria:** passes.",
    ].join("\n\n");
    const r = checkTaskReadiness(body);
    expect(r.ready).toBe(true);
  });

  it("scope signal via ## Implementation heading (matches)", () => {
    const body = [
      "Touches `src/foo.ts`.",
      "## Implementation",
      "Do the thing.",
      "**Out of scope:** nothing.",
      "## Acceptance criteria",
      "Tests pass.",
    ].join("\n\n");
    const r = checkTaskReadiness(body);
    expect(r.ready).toBe(true);
  });

  it("scope signal via ## Approach heading (matches)", () => {
    const body = [
      "Touches `src/foo.ts`.",
      "## Approach",
      "Do the thing.",
      "**Out of scope:** nothing.",
      "**Acceptance criteria:** passes.",
    ].join("\n\n");
    const r = checkTaskReadiness(body);
    expect(r.ready).toBe(true);
  });

  // Files signal fixtures
  it("files signal via wikilink like [[wikis/_meta/foo.md]] (matches .md)", () => {
    const body = [
      "See [[wikis/_meta/foo.md]] for context.",
      "**Scope:** do the thing.",
      "**Out of scope:** nothing.",
      "**Acceptance criteria:** passes.",
    ].join("\n\n");
    const r = checkTaskReadiness(body);
    expect(r.ready).toBe(true);
  });

  it("files signal absent when no path-like substring present", () => {
    const body = [
      "No file references here.",
      "**Scope:** do the thing.",
      "**Out of scope:** nothing.",
      "**Acceptance criteria:** passes.",
    ].join("\n\n");
    const r = checkTaskReadiness(body);
    expect(r.ready).toBe(false);
    if (!r.ready) {
      expect(r.missing).toContain("files");
      expect(r.missing).not.toContain("scope");
      expect(r.missing).not.toContain("out_of_scope");
      expect(r.missing).not.toContain("verification");
    }
  });

  it("files signal matches .ts, .json, .sql, .py, .go, .rs, .yaml, .toml, .sh extensions", () => {
    const extensions = ["ts", "json", "sql", "py", "go", "rs", "yaml", "toml", "sh"];
    for (const ext of extensions) {
      const body = [
        `Touches src/foo.${ext}.`,
        "**Scope:** do the thing.",
        "**Out of scope:** nothing.",
        "**Acceptance criteria:** passes.",
      ].join("\n\n");
      const r = checkTaskReadiness(body);
      expect(r.ready).toBe(true, `Expected ready=true for extension .${ext}`);
    }
  });

  it("files signal accepts optional :<line> suffix", () => {
    const body = [
      "Touches `src/foo.ts:42`.",
      "**Scope:** do the thing.",
      "**Out of scope:** nothing.",
      "**Acceptance criteria:** passes.",
    ].join("\n\n");
    expect(checkTaskReadiness(body)).toEqual({ ready: true });
  });

  it("files signal accepts optional :<start>-<end> suffix", () => {
    const body = [
      "Touches `src/foo.ts:10-20`.",
      "**Scope:** do the thing.",
      "**Out of scope:** nothing.",
      "**Acceptance criteria:** passes.",
    ].join("\n\n");
    expect(checkTaskReadiness(body)).toEqual({ ready: true });
  });

  // Out-of-scope fixtures
  it("out-of-scope via inline phrase 'this is out of scope for v1' (matches)", () => {
    const body = [
      "Touches `src/foo.ts`.",
      "**Scope:** do the thing.",
      "Auth is out of scope for v1.",
      "**Acceptance criteria:** passes.",
    ].join("\n\n");
    const r = checkTaskReadiness(body);
    expect(r.ready).toBe(true);
  });

  // Verification signal fixtures
  it("verification via heading ## Acceptance criteria (matches)", () => {
    const body = [
      "Touches `src/foo.ts`.",
      "## Scope",
      "Do the thing.",
      "**Out of scope:** nothing.",
      "## Acceptance criteria",
      "Tests pass.",
    ].join("\n\n");
    const r = checkTaskReadiness(body);
    expect(r.ready).toBe(true);
  });

  it("verification via ## Verification heading", () => {
    const body = [
      "Touches `src/foo.ts`.",
      "**Scope:** do the thing.",
      "**Out of scope:** nothing.",
      "## Verification",
      "All checks pass.",
    ].join("\n\n");
    expect(checkTaskReadiness(body)).toEqual({ ready: true });
  });

  it("verification via **Done when:** bold marker", () => {
    const body = [
      "Touches `src/foo.ts`.",
      "**Scope:** do the thing.",
      "**Out of scope:** nothing.",
      "**Done when:** tests pass.",
    ].join("\n\n");
    expect(checkTaskReadiness(body)).toEqual({ ready: true });
  });

  it("is pure: same input returns same output", () => {
    const body = "A simple body.";
    const r1 = checkTaskReadiness(body);
    const r2 = checkTaskReadiness(body);
    expect(r1).toEqual(r2);
  });

  it("the full acceptance-criteria body returns ready true", () => {
    // body containing src/foo.ts, **Scope:**, out of scope, and **Acceptance:**
    const body = [
      "Modifies `src/foo.ts`.",
      "**Scope:** numbered steps.",
      "This is out of scope.",
      "**Acceptance:** all tests pass.",
    ].join("\n\n");
    expect(checkTaskReadiness(body)).toEqual({ ready: true });
  });

  it("regexes are case-insensitive", () => {
    const body = [
      "Touches `SRC/FOO.TS`.",
      "**SCOPE:** do the thing.",
      "OUT OF SCOPE: nothing.",
      "**ACCEPTANCE CRITERIA:** passes.",
    ].join("\n\n");
    expect(checkTaskReadiness(body)).toEqual({ ready: true });
  });
});
