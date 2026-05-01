import { describe, it, expect } from "vitest";
import { getAdapter } from "../../src/core/runtime-adapters/registry.js";
import { UnknownRuntimeError } from "../../src/core/runtime-adapters/types.js";

describe("runtime-adapters/registry — getAdapter", () => {
  it("returns the claude-code adapter", () => {
    const adapter = getAdapter("claude-code");
    expect(adapter.name).toBe("claude-code");
    expect(typeof adapter.validate).toBe("function");
    expect(typeof adapter.serialize).toBe("function");
    expect(typeof adapter.deploy).toBe("function");
    expect(typeof adapter.verify).toBe("function");
    expect(typeof adapter.remove).toBe("function");
  });

  it("throws UnknownRuntimeError for an unknown runtime", () => {
    // @ts-expect-error — testing runtime guard
    expect(() => getAdapter("openclaw")).toThrow(UnknownRuntimeError);
  });
});
