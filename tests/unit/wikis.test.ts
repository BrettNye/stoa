import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWikiMeta } from "../../src/core/wikis.js";

// Phase-2 T2-1 — `loadWikiMeta` parses `family:` from a wiki's CLAUDE.md.
// Accepts both the markdown-bold form (`**Family:** rastate`) emitted by
// `vault.new-wiki` today and the plain key:value form (`family: rastate`)
// per spec §5.1. Empty-string family is treated as no-family. Missing
// CLAUDE.md returns an empty meta.
//
// v1.7 §5.7 — `loadWikiMeta` was extended to also parse `mode:` (was
// hardcoded to "mixed" in core/reindex.ts pre-v1.7). Same two declaration
// shapes; same empty-string-treated-as-absent rule.

describe("loadWikiMeta", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-wikis-meta-"));
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  function writeClaude(wiki: string, contents: string): void {
    const root = join(vaultPath, "wikis", wiki);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "CLAUDE.md"), contents);
  }

  it("parses the markdown-bold form `**Family:** rastate`", () => {
    writeClaude(
      "rastate-app",
      "# rastate-app — wiki conventions\n\n**Mode:** project-doc\n**Family:** rastate\n**Scope:** test\n"
    );
    expect(loadWikiMeta(vaultPath, "rastate-app")).toEqual({ family: "rastate", mode: "project-doc" });
  });

  it("parses the plain key:value form `family: rastate`", () => {
    writeClaude(
      "rastate-app",
      "# rastate-app — wiki conventions\n\nmode: project-doc\nfamily: rastate\nscope: test\n"
    );
    expect(loadWikiMeta(vaultPath, "rastate-app")).toEqual({ family: "rastate", mode: "project-doc" });
  });

  it("trims surrounding whitespace from the family value", () => {
    writeClaude(
      "rastate-app",
      "# rastate-app — wiki conventions\n\n**Family:**   rastate   \n"
    );
    expect(loadWikiMeta(vaultPath, "rastate-app")).toEqual({ family: "rastate" });
  });

  it("returns mode-only when CLAUDE.md has no family field (v1.7 §5.7)", () => {
    writeClaude(
      "alpha",
      "# alpha — wiki conventions\n\n**Mode:** mixed\n**Scope:** test\n"
    );
    expect(loadWikiMeta(vaultPath, "alpha")).toEqual({ mode: "mixed" });
  });

  it("returns mode-only when family value is empty string (v1.7 §5.7)", () => {
    writeClaude(
      "alpha",
      "# alpha — wiki conventions\n\n**Family:** \n**Mode:** mixed\n"
    );
    expect(loadWikiMeta(vaultPath, "alpha")).toEqual({ mode: "mixed" });
  });

  it("returns {} when CLAUDE.md is missing", () => {
    // Wiki dir not created at all.
    expect(loadWikiMeta(vaultPath, "ghost-wiki")).toEqual({});
  });

  it("returns {} when CLAUDE.md has neither family nor mode (v1.7 §5.7)", () => {
    writeClaude(
      "alpha",
      "# alpha — wiki conventions\n\n**Scope:** test\n"
    );
    expect(loadWikiMeta(vaultPath, "alpha")).toEqual({});
  });

  it("parses the markdown-bold mode form `**Mode:** project-doc` (v1.7 §5.7)", () => {
    writeClaude(
      "alpha",
      "# alpha — wiki conventions\n\n**Mode:** project-doc\n**Scope:** test\n"
    );
    expect(loadWikiMeta(vaultPath, "alpha")).toEqual({ mode: "project-doc" });
  });

  it("parses the plain key:value mode form `mode: idea-map` (v1.7 §5.7)", () => {
    writeClaude(
      "alpha",
      "# alpha — wiki conventions\n\nmode: idea-map\n"
    );
    expect(loadWikiMeta(vaultPath, "alpha")).toEqual({ mode: "idea-map" });
  });

  it("trims surrounding whitespace from the mode value (v1.7 §5.7)", () => {
    writeClaude(
      "alpha",
      "# alpha — wiki conventions\n\n**Mode:**   project-doc   \n"
    );
    expect(loadWikiMeta(vaultPath, "alpha")).toEqual({ mode: "project-doc" });
  });
});
