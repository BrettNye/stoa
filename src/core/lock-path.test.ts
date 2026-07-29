import { describe, it, expect } from "vitest";
import { canonicalizeLockPath, isCanonical, hasGlob } from "./lock-path.js";

describe("canonicalizeLockPath", () => {
  const variants = [
    "src/core/scope-hash.ts",
    "./src/core/scope-hash.ts",
    ".//src/core/scope-hash.ts",
    "src//core/scope-hash.ts",
    "src\\core\\scope-hash.ts",
    "src/core/scope-hash.ts/",
  ];

  it("maps every equivalent spelling to a byte-identical string", () => {
    const expected = "src/core/scope-hash.ts";
    for (const variant of variants) {
      expect(canonicalizeLockPath(variant)).toBe(expected);
    }
  });

  it("is idempotent for every variant", () => {
    for (const variant of variants) {
      const once = canonicalizeLockPath(variant);
      const twice = canonicalizeLockPath(once);
      expect(twice).toBe(once);
    }
  });

  it("rejects a glob rather than repairing it", () => {
    expect(() => canonicalizeLockPath("src/**/*.ts")).toThrow(/glob/);
  });

  it("rejects an absolute unix path", () => {
    expect(() => canonicalizeLockPath("/abs/path.ts")).toThrow(/absolute/);
  });

  it("rejects an absolute windows path", () => {
    expect(() => canonicalizeLockPath("C:/abs/path.ts")).toThrow(/absolute/);
  });
});

describe("hasGlob", () => {
  it("returns true when the input contains *", () => {
    expect(hasGlob("src/*/file.ts")).toBe(true);
  });

  it("returns true when the input contains ?", () => {
    expect(hasGlob("src/fil?.ts")).toBe(true);
  });

  it("returns true when the input contains [", () => {
    expect(hasGlob("src/[abc].ts")).toBe(true);
  });

  it("returns false for a path with none of the glob metacharacters", () => {
    expect(hasGlob("src/core/scope-hash.ts")).toBe(false);
  });
});

describe("isCanonical", () => {
  it("returns true for the canonical form", () => {
    expect(isCanonical("src/core/scope-hash.ts")).toBe(true);
  });

  it("returns false for each non-canonical variant", () => {
    const nonCanonical = [
      "./src/core/scope-hash.ts",
      ".//src/core/scope-hash.ts",
      "src//core/scope-hash.ts",
      "src\\core\\scope-hash.ts",
      "src/core/scope-hash.ts/",
    ];
    for (const variant of nonCanonical) {
      expect(isCanonical(variant)).toBe(false);
    }
  });

  it("returns false for a glob input", () => {
    expect(isCanonical("src/**/*.ts")).toBe(false);
  });

  it("returns false for an absolute input", () => {
    expect(isCanonical("/abs/path.ts")).toBe(false);
  });
});
