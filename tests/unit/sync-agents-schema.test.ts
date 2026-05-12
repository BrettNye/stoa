import { describe, it, expect } from "vitest";
import { syncAgentsTool } from "../../src/tools/sync-agents.js";

const schema = syncAgentsTool.inputSchema;

describe("sync-agents input schema", () => {
  it("accepts pokemon: string", () => {
    expect(schema.safeParse({ pokemon: "abra", target: "/tmp/x" }).success).toBe(true);
  });
  it("accepts pokemon: string[]", () => {
    expect(schema.safeParse({ pokemon: ["abra"], target: "/tmp/x" }).success).toBe(true);
  });
  it("accepts all: true with no pokemon", () => {
    expect(schema.safeParse({ all: true, target: "/tmp/x" }).success).toBe(true);
  });
  it("accepts all: true with exclude + pokemon_type", () => {
    expect(schema.safeParse({
      all: true, target: "/tmp/x", exclude: ["mewtwo"], pokemon_type: ["water"]
    }).success).toBe(true);
  });
  it("rejects pokemon AND all together", () => {
    const r = schema.safeParse({ pokemon: "abra", all: true, target: "/tmp/x" });
    expect(r.success).toBe(false);
  });
  it("rejects neither pokemon nor all", () => {
    const r = schema.safeParse({ target: "/tmp/x" });
    expect(r.success).toBe(false);
  });
  it("rejects exclude without all: true", () => {
    const r = schema.safeParse({ pokemon: "abra", target: "/tmp/x", exclude: ["x"] });
    expect(r.success).toBe(false);
  });
});
