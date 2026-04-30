import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { lint } from "../../src/core/lint.js";
import { reindex } from "../../src/core/reindex.js";

const VAULT = process.cwd().replace(/[/\\]vault-mcp[/\\]?$/, "");

describe("Plan D recipes — UC2 + UC4", () => {
  it("profile-aerodactyl exists and lints clean against _agents wiki", () => {
    const path = join(VAULT, "wikis", "_agents", "profiles", "profile-aerodactyl.md");
    expect(existsSync(path)).toBe(true);
    reindex(VAULT);
    const result = lint(VAULT, { wiki: "_agents" });
    const errors = result.diagnostics.filter(d => d.severity === "error" && d.page_id === "profile-aerodactyl");
    expect(errors).toHaveLength(0);
  });

  it("guide-openclaw-integration exists and is non-trivial", () => {
    const path = join(VAULT, "wikis", "_meta", "guides", "guide-openclaw-integration.md");
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf8");
    expect(content.length).toBeGreaterThan(500);
    expect(content).toMatch(/mcporter/);
    expect(content).toMatch(/aerodactyl/i);
  });
});
