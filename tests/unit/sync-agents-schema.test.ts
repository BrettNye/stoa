import { describe, it, expect } from "vitest";
import { syncTool } from "../../src/tools/sync.js";

const schema = syncTool.inputSchema;

describe("vault_sync surface=agents input schema", () => {
  it("accepts pokemon: string", () => {
    expect(schema.safeParse({ surface: "agents", pokemon: "abra", repo_path: "/tmp/x" }).success).toBe(true);
  });
  it("accepts pokemon: string[]", () => {
    expect(schema.safeParse({ surface: "agents", pokemon: ["abra"], repo_path: "/tmp/x" }).success).toBe(true);
  });
  it("accepts all: true with no pokemon", () => {
    expect(schema.safeParse({ surface: "agents", all: true, repo_path: "/tmp/x" }).success).toBe(true);
  });
  it("accepts all: true with exclude + pokemon_type", () => {
    expect(schema.safeParse({
      surface: "agents", all: true, repo_path: "/tmp/x", exclude: ["mewtwo"], pokemon_type: ["water"]
    }).success).toBe(true);
  });
  it("accepts pokemon AND all together at schema level (handler enforces)", () => {
    // Schema has NO top-level refines — handler enforces agents refines
    const r = schema.safeParse({ surface: "agents", pokemon: "abra", all: true, repo_path: "/tmp/x" });
    expect(r.success).toBe(true);
  });
  it("accepts neither pokemon nor all at schema level (handler enforces)", () => {
    const r = schema.safeParse({ surface: "agents", repo_path: "/tmp/x" });
    expect(r.success).toBe(true);
  });
  it("accepts exclude without all: true at schema level (handler enforces)", () => {
    const r = schema.safeParse({ surface: "agents", pokemon: "abra", repo_path: "/tmp/x", exclude: ["x"] });
    expect(r.success).toBe(true);
  });
});
