import { describe, it, expect } from "vitest";
import { syncSkillsTool } from "../../src/tools/sync-skills.js";

const schema = syncSkillsTool.inputSchema;

describe("sync-skills input schema", () => {
  it("accepts pokemon: string", () => {
    expect(schema.safeParse({ repo_path: "/tmp/x", pokemon: "abra" }).success).toBe(true);
  });
  it("accepts all: true with no pokemon", () => {
    expect(schema.safeParse({ repo_path: "/tmp/x", all: true }).success).toBe(true);
  });
  it("accepts reverify: true with no pokemon (existing implicit-all path)", () => {
    expect(schema.safeParse({ repo_path: "/tmp/x", reverify: true }).success).toBe(true);
  });
  it("rejects pokemon AND all together", () => {
    expect(schema.safeParse({ repo_path: "/tmp/x", pokemon: "abra", all: true }).success).toBe(false);
  });
  it("rejects deploy mode with neither pokemon nor all", () => {
    expect(schema.safeParse({ repo_path: "/tmp/x" }).success).toBe(false);
  });
  it("accepts exclude + pokemon_type with all: true", () => {
    expect(schema.safeParse({
      repo_path: "/tmp/x", all: true, exclude: ["mewtwo"], pokemon_type: ["water"]
    }).success).toBe(true);
  });
});
