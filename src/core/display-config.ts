/**
 * core/display-config — operator-tunable display knobs sourced from a fenced
 * YAML block in `wikis/_agents/CLAUDE.md`.
 *
 * Wave 2 ships a defaults-returning stub so callers can wire against the
 * locked interface. Wave 4 replaces the body with real fenced-YAML extraction
 * (no schema or call-site changes — drop-in).
 *
 * Defaults:
 *   - `statusline.emoji_safe_mode = false`  (UTF-8 emoji allowed)
 *   - `sprites.color_mode = "truecolor"`    (24-bit ANSI escapes)
 */

import type { ColorMode } from "./sprites-runtime.js";

export interface DisplayConfig {
  statusline: { emoji_safe_mode: boolean };
  sprites:    { color_mode: ColorMode };
}

export const DEFAULT_DISPLAY_CONFIG: DisplayConfig = {
  statusline: { emoji_safe_mode: false },
  sprites:    { color_mode: "truecolor" }
};

/**
 * Reads display_config block from `wikis/_agents/CLAUDE.md`.
 *
 * Wave 2: returns DEFAULT_DISPLAY_CONFIG unconditionally.
 * Wave 4: parses fenced YAML, validates color_mode against the ColorMode
 * union, falls back to defaults on missing file / parse error / invalid value.
 */
export function readDisplayConfig(_vaultPath: string): DisplayConfig {
  return DEFAULT_DISPLAY_CONFIG;
}
