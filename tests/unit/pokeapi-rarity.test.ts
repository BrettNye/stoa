// tests/unit/pokeapi-rarity.test.ts
//
// Unit tests for the `classifyRarity` helper in core/pokeapi.ts.
// Tests the priority chain: mythical > legendary > baby > common.

import { describe, it, expect } from "vitest";
import { classifyRarity } from "../../src/core/pokeapi.js";

describe("classifyRarity", () => {
  it("returns 'mythical' when is_mythical is true", () => {
    expect(classifyRarity({ is_mythical: true, is_legendary: false, is_baby: false })).toBe("mythical");
  });

  it("returns 'mythical' when is_mythical is true even if is_legendary is also true", () => {
    // mythical > legendary priority
    expect(classifyRarity({ is_mythical: true, is_legendary: true, is_baby: false })).toBe("mythical");
  });

  it("returns 'legendary' when is_legendary is true and is_mythical is false", () => {
    expect(classifyRarity({ is_mythical: false, is_legendary: true, is_baby: false })).toBe("legendary");
  });

  it("returns 'baby' when is_baby is true and neither mythical nor legendary", () => {
    expect(classifyRarity({ is_mythical: false, is_legendary: false, is_baby: true })).toBe("baby");
  });

  it("returns 'common' when none of the flags are set", () => {
    expect(classifyRarity({ is_mythical: false, is_legendary: false, is_baby: false })).toBe("common");
  });

  it("returns 'common' when all flags are undefined (missing)", () => {
    expect(classifyRarity({})).toBe("common");
  });

  it("returns 'legendary' when only is_legendary is true (is_mythical undefined)", () => {
    expect(classifyRarity({ is_legendary: true })).toBe("legendary");
  });

  it("returns 'baby' when only is_baby is true", () => {
    expect(classifyRarity({ is_baby: true })).toBe("baby");
  });

  it("returns 'mythical' when is_mythical is true and is_baby is also true", () => {
    // mythical takes precedence over baby
    expect(classifyRarity({ is_mythical: true, is_baby: true })).toBe("mythical");
  });

  it("returns 'legendary' when is_legendary is true and is_baby is also true", () => {
    // legendary > baby priority
    expect(classifyRarity({ is_legendary: true, is_baby: true })).toBe("legendary");
  });
});
