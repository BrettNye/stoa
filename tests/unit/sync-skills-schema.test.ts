import { describe, it, expect } from "vitest";
import { syncTool } from "../../src/tools/sync.js";

const schema = syncTool.inputSchema;

describe("vault_sync surface=skills input schema", () => {
  it("accepts pokemon: string", () => {
    expect(schema.safeParse({ surface: "skills", repo_path: "/tmp/x", pokemon: "abra" }).success).toBe(true);
  });
  it("accepts all: true with no pokemon", () => {
    expect(schema.safeParse({ surface: "skills", repo_path: "/tmp/x", all: true }).success).toBe(true);
  });
  it("accepts reverify: true with no pokemon (existing implicit-all path)", () => {
    expect(schema.safeParse({ surface: "skills", repo_path: "/tmp/x", reverify: true }).success).toBe(true);
  });
  it("accepts pokemon AND all together at schema level (handler enforces)", () => {
    // Schema does NOT have top-level refines — handler enforces surface refines
    expect(schema.safeParse({ surface: "skills", repo_path: "/tmp/x", pokemon: "abra", all: true }).success).toBe(true);
  });
  it("accepts deploy mode with neither pokemon nor all at schema level (handler enforces)", () => {
    expect(schema.safeParse({ surface: "skills", repo_path: "/tmp/x" }).success).toBe(true);
  });
  it("accepts exclude + pokemon_type with all: true", () => {
    expect(schema.safeParse({
      surface: "skills", repo_path: "/tmp/x", all: true, exclude: ["mewtwo"], pokemon_type: ["water"]
    }).success).toBe(true);
  });
});
