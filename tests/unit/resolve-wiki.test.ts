import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveWiki, WikiRequiredError } from "../../src/tools/_resolve-wiki.js";

// Regression lock for the documented resolution order (v1.5 spec, vault root CLAUDE.md):
//   tool-arg > --default-wiki > .active-wiki > error
// Wave 3 Task 3-4c (active-wiki-divergence lint check) relies on this ordering being stable.
describe("resolveWiki — resolution order (T2-3)", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-resolve-wiki-"));
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("Case 1: tool-arg wins over --default-wiki and .active-wiki", () => {
    writeFileSync(join(vaultPath, ".active-wiki"), "baz");
    expect(resolveWiki("foo", "bar", vaultPath)).toBe("foo");
  });

  it("Case 2: --default-wiki wins over .active-wiki when tool-arg is unset", () => {
    writeFileSync(join(vaultPath, ".active-wiki"), "baz");
    expect(resolveWiki(undefined, "bar", vaultPath)).toBe("bar");
  });

  it("Case 3: .active-wiki used when tool-arg and --default-wiki are unset", () => {
    writeFileSync(join(vaultPath, ".active-wiki"), "baz");
    expect(resolveWiki(undefined, undefined, vaultPath)).toBe("baz");
  });

  it("Case 4: throws WikiRequiredError when all three sources are unset", () => {
    // No .active-wiki file written.
    expect(() => resolveWiki(undefined, undefined, vaultPath)).toThrow(WikiRequiredError);
  });

  it("Case 4b: throws WikiRequiredError when .active-wiki exists but is empty/whitespace", () => {
    writeFileSync(join(vaultPath, ".active-wiki"), "   \n");
    expect(() => resolveWiki(undefined, undefined, vaultPath)).toThrow(WikiRequiredError);
  });

  // Empty-string defensive case: the current implementation uses a truthy check
  // (`if (argWiki) return argWiki`), so "" is falsy and falls through to the
  // lower-priority sources. This is the safer behavior — an accidentally empty
  // tool arg should not shadow a configured --default-wiki or .active-wiki.
  it("Case 5: empty-string tool-arg is treated as 'not provided' and falls through to --default-wiki", () => {
    writeFileSync(join(vaultPath, ".active-wiki"), "baz");
    expect(resolveWiki("", "bar", vaultPath)).toBe("bar");
  });

  it("Case 5b: empty-string tool-arg AND empty-string default falls through to .active-wiki", () => {
    writeFileSync(join(vaultPath, ".active-wiki"), "baz");
    expect(resolveWiki("", "", vaultPath)).toBe("baz");
  });

  it("trims whitespace from .active-wiki contents", () => {
    writeFileSync(join(vaultPath, ".active-wiki"), "  baz  \n");
    expect(resolveWiki(undefined, undefined, vaultPath)).toBe("baz");
  });
});
