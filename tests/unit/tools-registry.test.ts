import { describe, it, expect } from "vitest";
import { allTools } from "../../src/tools/index.js";

describe("tool registry", () => {
  it("exports exactly 43 tools", () => {
    expect(allTools).toHaveLength(43);
  });

  it("every tool has name/description/inputSchema/handler", () => {
    for (const t of allTools) {
      expect(t.name).toMatch(/^vault_/);
      expect(t.description.length).toBeGreaterThan(10);
      expect(t.inputSchema).toBeDefined();
      expect(typeof t.handler).toBe("function");
    }
  });

  it("tool names are unique", () => {
    const names = allTools.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
