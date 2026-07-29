// src/core/four-section.test.ts
import { describe, it, expect } from "vitest";
import { renderFourSection, parseFourSection, validateEnvelope } from "./four-section.js";
import { checkTaskReadiness } from "./task-readiness.js";

const concern = {
  title: "Split oversized scope-hash module",
  files: ["src/core/scope-hash.ts"],
  scope: "Extract the dimension helper into its own function.",
  out_of_scope: "Does not change the hash algorithm or its output.",
  verification: "scope-hash.test.ts passes and exports two functions.",
};

describe("four-section", () => {
  it("renders a body that satisfies the readiness gate", () => {
    expect(checkTaskReadiness(renderFourSection(concern))).toEqual({ ready: true });
  });

  it("round-trips each section back out", () => {
    const body = renderFourSection(concern);
    expect(parseFourSection(body, "Verification")).toContain("scope-hash.test.ts passes");
  });

  it("rejects an unknown schemaVersion instead of harvesting nothing", () => {
    expect(validateEnvelope({ schemaVersion: 2, concerns: [] })).toHaveLength(1);
  });

  it("emits exact heading spellings and includes every file entry", () => {
    const body = renderFourSection(concern);
    expect(body).toContain("## Scope");
    expect(body).toContain("## Out of scope");
    expect(body).toContain("## Verification");
    for (const f of concern.files) {
      expect(body).toContain(f);
    }
  });

  it("parses Scope and Out of scope sections with heading line excluded and whitespace trimmed", () => {
    const body = renderFourSection(concern);
    expect(parseFourSection(body, "Scope")).toContain(concern.scope);
    expect(parseFourSection(body, "Scope")).not.toContain("## Scope");
    const outOfScope = parseFourSection(body, "Out of scope");
    expect(outOfScope).toContain(concern.out_of_scope);
    expect(outOfScope).not.toContain("## Out of scope");
    const verification = parseFourSection(body, "Verification");
    expect(verification).toBe(verification.trim());
    expect(verification).not.toContain("## Verification");
  });

  it("returns empty string for a nonexistent section rather than throwing", () => {
    const body = renderFourSection(concern);
    expect(() => parseFourSection(body, "Nonexistent")).not.toThrow();
    expect(parseFourSection(body, "Nonexistent")).toBe("");
  });

  it("validateEnvelope accepts a valid envelope with schemaVersion 1", () => {
    expect(validateEnvelope({ schemaVersion: 1, concerns: [] })).toEqual([]);
  });

  it("validateEnvelope rejects a non-object input", () => {
    expect(validateEnvelope(null).length).toBeGreaterThan(0);
    expect(validateEnvelope("string").length).toBeGreaterThan(0);
  });

  it("validateEnvelope rejects when concerns is not an array", () => {
    const errs = validateEnvelope({ schemaVersion: 1, concerns: "nope" });
    expect(errs.length).toBeGreaterThan(0);
  });

  it("parses an empty non-last section as '' without bleeding into the next section", () => {
    const body = renderFourSection({ ...concern, out_of_scope: "" });
    expect(parseFourSection(body, "Out of scope")).toBe("");
    expect(parseFourSection(body, "Verification")).toBe(concern.verification);
  });

  it("parses a whitespace-only non-last section as '' without bleeding into the next section", () => {
    const body = renderFourSection({ ...concern, out_of_scope: "   " });
    expect(parseFourSection(body, "Out of scope")).toBe("");
    expect(parseFourSection(body, "Verification")).toBe(concern.verification);
  });

  it("still parses the last section correctly, including trailing whitespace handling", () => {
    const body = renderFourSection(concern);
    expect(parseFourSection(body, "Verification")).toBe(concern.verification);
  });

  it("matches a heading containing regex metacharacters literally instead of throwing", () => {
    const body = "## Foo (unterminated\nbar\n";
    expect(() => parseFourSection(body, "Foo (unterminated")).not.toThrow();
    expect(parseFourSection(body, "Foo (unterminated")).toBe("bar");
  });
});
