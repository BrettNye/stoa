import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  readDisplayConfig,
  validateDisplayConfigBlock,
  DEFAULT_DISPLAY_CONFIG
} from "../../src/core/display-config.js";

// Wave-4 (T4-1): the full fenced-YAML reader replaces the Wave-2 stub.
// Both flags (`statusline.emoji_safe_mode` and `sprites.color_mode`) parse
// cleanly; missing/malformed/invalid blocks fall back to defaults silently
// at runtime; `validateDisplayConfigBlock` is the lint-side helper that
// surfaces parse/validation errors instead of swallowing them.

function writeAgentsClaudeMd(vault: string, body: string): void {
  mkdirSync(join(vault, "wikis", "_agents"), { recursive: true });
  writeFileSync(join(vault, "wikis", "_agents", "CLAUDE.md"), body);
}

describe("display-config — readDisplayConfig (T4-1)", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "display-config-"));
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("DEFAULT_DISPLAY_CONFIG defaults to truecolor sprites and emoji-safe-mode off", () => {
    expect(DEFAULT_DISPLAY_CONFIG.sprites.color_mode).toBe("truecolor");
    expect(DEFAULT_DISPLAY_CONFIG.statusline.emoji_safe_mode).toBe(false);
  });

  it("returns defaults when wikis/_agents/CLAUDE.md is missing", () => {
    const cfg = readDisplayConfig(vaultPath);
    expect(cfg).toEqual(DEFAULT_DISPLAY_CONFIG);
  });

  it("returns defaults when CLAUDE.md exists but has no display_config block", () => {
    writeAgentsClaudeMd(vaultPath, "# _agents\n\nNo display_config block.\n");
    const cfg = readDisplayConfig(vaultPath);
    expect(cfg).toEqual(DEFAULT_DISPLAY_CONFIG);
  });

  it("parses a valid block with both flags set", () => {
    writeAgentsClaudeMd(vaultPath,
      "# _agents\n\n```yaml display_config\n" +
      "statusline:\n  emoji_safe_mode: true\n" +
      "sprites:\n  color_mode: ansi\n" +
      "```\n");
    const cfg = readDisplayConfig(vaultPath);
    expect(cfg.statusline.emoji_safe_mode).toBe(true);
    expect(cfg.sprites.color_mode).toBe("ansi");
  });

  it("merges partial config (only statusline) with defaults", () => {
    writeAgentsClaudeMd(vaultPath,
      "# _agents\n\n```yaml display_config\n" +
      "statusline:\n  emoji_safe_mode: true\n" +
      "```\n");
    const cfg = readDisplayConfig(vaultPath);
    expect(cfg.statusline.emoji_safe_mode).toBe(true);
    expect(cfg.sprites.color_mode).toBe("truecolor");
  });

  it("merges partial config (only sprites) with defaults", () => {
    writeAgentsClaudeMd(vaultPath,
      "# _agents\n\n```yaml display_config\n" +
      "sprites:\n  color_mode: none\n" +
      "```\n");
    const cfg = readDisplayConfig(vaultPath);
    expect(cfg.statusline.emoji_safe_mode).toBe(false);
    expect(cfg.sprites.color_mode).toBe("none");
  });

  it("falls back to defaults silently when YAML is malformed", () => {
    writeAgentsClaudeMd(vaultPath,
      "# _agents\n\n```yaml display_config\n" +
      "statusline:\n  emoji_safe_mode: [unclosed\n" +
      "```\n");
    const cfg = readDisplayConfig(vaultPath);
    expect(cfg).toEqual(DEFAULT_DISPLAY_CONFIG);
  });

  it("falls back to defaults silently when schema validation fails", () => {
    writeAgentsClaudeMd(vaultPath,
      "# _agents\n\n```yaml display_config\n" +
      "sprites:\n  color_mode: rainbow\n" +
      "```\n");
    const cfg = readDisplayConfig(vaultPath);
    expect(cfg).toEqual(DEFAULT_DISPLAY_CONFIG);
  });

  it("supports color_mode: truecolor", () => {
    writeAgentsClaudeMd(vaultPath,
      "# _agents\n\n```yaml display_config\n" +
      "sprites:\n  color_mode: truecolor\n" +
      "```\n");
    const cfg = readDisplayConfig(vaultPath);
    expect(cfg.sprites.color_mode).toBe("truecolor");
  });
});

describe("display-config — validateDisplayConfigBlock (T4-1)", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "display-config-"));
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("returns null when CLAUDE.md is missing", () => {
    expect(validateDisplayConfigBlock(vaultPath)).toBeNull();
  });

  it("returns null when block is absent", () => {
    writeAgentsClaudeMd(vaultPath, "# _agents\n\nno block\n");
    expect(validateDisplayConfigBlock(vaultPath)).toBeNull();
  });

  it("returns { ok: true } for a valid block", () => {
    writeAgentsClaudeMd(vaultPath,
      "# _agents\n\n```yaml display_config\n" +
      "statusline:\n  emoji_safe_mode: true\n" +
      "sprites:\n  color_mode: ansi\n" +
      "```\n");
    const r = validateDisplayConfigBlock(vaultPath);
    expect(r).toEqual({ ok: true });
  });

  it("returns { ok: false; reason } when YAML is malformed", () => {
    writeAgentsClaudeMd(vaultPath,
      "# _agents\n\n```yaml display_config\n" +
      "statusline:\n  emoji_safe_mode: [unclosed\n" +
      "```\n");
    const r = validateDisplayConfigBlock(vaultPath);
    expect(r).not.toBeNull();
    expect(r && "ok" in r && r.ok).toBe(false);
    if (r && r.ok === false) {
      expect(typeof r.reason).toBe("string");
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  it("returns { ok: false; reason } when color_mode is invalid", () => {
    writeAgentsClaudeMd(vaultPath,
      "# _agents\n\n```yaml display_config\n" +
      "sprites:\n  color_mode: rainbow\n" +
      "```\n");
    const r = validateDisplayConfigBlock(vaultPath);
    expect(r).not.toBeNull();
    expect(r && "ok" in r && r.ok).toBe(false);
    if (r && r.ok === false) {
      expect(r.reason).toMatch(/color_mode|rainbow/);
    }
  });
});
