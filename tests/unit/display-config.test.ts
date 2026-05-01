import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  readDisplayConfig,
  DEFAULT_DISPLAY_CONFIG
} from "../../src/core/display-config.js";

// Wave-2 stub: real fenced-YAML extraction lands in Wave 4. For now the
// reader is a defaults-returning shim so `tools/start.ts` can call it
// against a stable interface and Wave 4 can drop in cleanly.

describe("display-config — Wave 2 stub", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "display-config-"));
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("returns DEFAULT_DISPLAY_CONFIG for any vault path (stub)", () => {
    const cfg = readDisplayConfig(vaultPath);
    expect(cfg).toEqual(DEFAULT_DISPLAY_CONFIG);
  });

  it("DEFAULT_DISPLAY_CONFIG defaults to truecolor sprites and emoji-safe-mode off", () => {
    expect(DEFAULT_DISPLAY_CONFIG.sprites.color_mode).toBe("truecolor");
    expect(DEFAULT_DISPLAY_CONFIG.statusline.emoji_safe_mode).toBe(false);
  });
});
