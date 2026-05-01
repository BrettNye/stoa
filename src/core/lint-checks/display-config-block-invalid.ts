import { registerLintCheck } from "../lint-check.js";
import { validateDisplayConfigBlock } from "../display-config.js";

// DISPLAY_CONFIG_BLOCK_INVALID (severity:warning). v1.6 Phase 3 T4-1.
//
// Sibling to THRESHOLD_BLOCK_INVALID. At lint time, attempt to parse the
// `yaml display_config` fenced block in `wikis/_agents/CLAUDE.md` via
// `core/display-config.validateDisplayConfigBlock`. If the block is present
// but malformed (parse error) or fails schema validation (e.g., invalid
// `color_mode` enum value), surface a single diagnostic referencing the
// file path so the operator knows where to fix.
//
// Severity is `warning` (not `error`): runtime callers fall back to
// DEFAULT_DISPLAY_CONFIG silently, so a broken block degrades cosmetics
// (sprites and statusline rendering) rather than breaking workflows. The
// stricter THRESHOLD_BLOCK_INVALID is `error` because broken thresholds can
// silently mask intended evolution thresholds.
//
// Absence (no fence, no file, valid block) → no diagnostic.
registerLintCheck({
  code: "DISPLAY_CONFIG_BLOCK_INVALID",
  run(ctx, _idx, _input) {
    const result = validateDisplayConfigBlock(ctx.vaultPath);
    if (result === null || result.ok) return [];
    return [{
      severity: "warning" as const,
      code: "DISPLAY_CONFIG_BLOCK_INVALID",
      wiki: "_agents",
      message: result.reason,
      suggestion: "fix the 'yaml display_config' block in wikis/_agents/CLAUDE.md (or remove it to fall back to defaults: statusline.emoji_safe_mode=false, sprites.color_mode=truecolor)",
    }];
  },
});
