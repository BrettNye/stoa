import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newWiki, WikiExistsError } from "../../src/core/wikis.js";

let vault: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-wikis-"));
  writeFileSync(join(vault, "REGISTRY.md"), "# Wikis\n\n");
});

describe("newWiki", () => {
  it("creates wiki folder structure", () => {
    newWiki(vault, { name: "newproj", mode: "idea-map", scope: "test" });
    expect(existsSync(join(vault, "wikis", "newproj", "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(vault, "wikis", "newproj", "map.md"))).toBe(true);
    expect(existsSync(join(vault, "wikis", "newproj", "log.md"))).toBe(true);
    expect(existsSync(join(vault, "wikis", "newproj", "concepts"))).toBe(true);
    expect(existsSync(join(vault, "wikis", "newproj", "decisions"))).toBe(true);
  });

  it("updates REGISTRY.md", () => {
    newWiki(vault, { name: "newproj", mode: "idea-map", scope: "for testing" });
    const reg = readFileSync(join(vault, "REGISTRY.md"), "utf8");
    expect(reg).toMatch(/newproj/);
    expect(reg).toMatch(/idea-map/);
    expect(reg).toMatch(/for testing/);
  });

  it("refuses to create existing wiki", () => {
    newWiki(vault, { name: "dup", mode: "mixed", scope: "x" });
    expect(() => newWiki(vault, { name: "dup", mode: "mixed", scope: "y" }))
      .toThrow(WikiExistsError);
  });
});
