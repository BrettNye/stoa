// tests/unit/mode-helper.test.ts
// Unit tests for the shared requireField guard used by mode/surface-parametrized tools.

import { describe, it, expect } from "vitest";
import { requireField } from "../../src/tools/_mode.js";

describe("requireField", () => {
  it("throws a named error when the field is absent (undefined)", () => {
    expect(() => requireField(undefined, "vault_wait-for mode=any", "filters")).toThrow(
      /requires 'filters'/,
    );
  });

  it("throws a named error when the field is absent (null)", () => {
    expect(() => requireField(null, "vault_wait-for mode=any", "filters")).toThrow(
      /requires 'filters'/,
    );
  });

  it("includes the context in the error message", () => {
    expect(() => requireField(undefined, "vault_wait-for mode=any", "filters")).toThrow(
      /vault_wait-for mode=any/,
    );
  });

  it("returns the value when present", () => {
    expect(requireField("x", "ctx", "f")).toBe("x");
  });

  it("returns the value when present (non-string)", () => {
    expect(requireField(42, "ctx", "count")).toBe(42);
  });

  it("returns the value when it is 0 (falsy but not null/undefined)", () => {
    expect(requireField(0, "ctx", "offset")).toBe(0);
  });

  it("returns the value when it is an empty string (falsy but not null/undefined)", () => {
    expect(requireField("", "ctx", "name")).toBe("");
  });
});
