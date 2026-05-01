/**
 * core/display-config — operator-tunable display knobs sourced from a fenced
 * YAML block in `wikis/_agents/CLAUDE.md`.
 *
 * v1.6 Phase 3 T4-1: full fenced-YAML extraction. Mirrors the pattern in
 * `core/thresholds.ts` for the sibling `evolution_thresholds` block. Runtime
 * callers receive defaults on missing/malformed/invalid blocks (silent
 * fallback). The lint-side helper `validateDisplayConfigBlock` returns the
 * parse/validation error so `DISPLAY_CONFIG_BLOCK_INVALID` can surface it.
 *
 * Defaults:
 *   - `statusline.emoji_safe_mode = false`  (UTF-8 emoji allowed)
 *   - `sprites.color_mode = "truecolor"`    (24-bit ANSI escapes)
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { z } from "zod";

import type { ColorMode } from "./sprites-runtime.js";

export interface DisplayConfig {
  statusline: { emoji_safe_mode: boolean };
  sprites:    { color_mode: ColorMode };
}

export const DEFAULT_DISPLAY_CONFIG: DisplayConfig = {
  statusline: { emoji_safe_mode: false },
  sprites:    { color_mode: "truecolor" }
};

// Match the first fenced block whose info string is exactly `yaml display_config`,
// optionally followed by whitespace + further tokens. Body is non-greedy.
// Mirrors the pattern in core/thresholds.ts for `yaml evolution_thresholds`.
const FENCE_RE = /^```yaml display_config(?:[ \t][^\n]*)?\n([\s\S]*?)\n```/m;

const ConfigSchema = z.object({
  statusline: z.object({
    emoji_safe_mode: z.boolean()
  }).partial().optional(),
  sprites: z.object({
    color_mode: z.enum(["truecolor", "ansi", "none"])
  }).partial().optional()
});

type ParsedConfig = z.infer<typeof ConfigSchema>;

function claudeMdPath(vaultPath: string): string {
  return join(vaultPath, "wikis", "_agents", "CLAUDE.md");
}

function readClaudeMdOrNull(vaultPath: string): string | null {
  try {
    return readFileSync(claudeMdPath(vaultPath), "utf8");
  } catch (err: any) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) return null;
    throw err;
  }
}

function extractBody(raw: string): string | null {
  const match = raw.match(FENCE_RE);
  return match ? match[1] : null;
}

function parseYamlBody(body: string): unknown {
  // Use gray-matter's bundled js-yaml engine — same trick as
  // core/thresholds.ts. Wrap the body in frontmatter delimiters so `matter()`
  // treats the contents as YAML.
  //
  // NOTE: passing the empty options object `{}` is deliberate. gray-matter
  // has a global content-keyed cache that's bypassed when ANY options arg is
  // supplied (lib/index.js line ~37: `if (!options) { ... cache code ... }`).
  // Without it, two malformed-YAML test cases sharing identical bodies in a
  // single vitest process would see the SECOND call return `{}` from cache
  // instead of re-throwing — breaking `validateDisplayConfigBlock`'s contract
  // of "raise on bad YAML every time".
  const wrapped = `---\n${body}\n---\n`;
  const result = matter(wrapped, {});
  return result.data;
}

function mergeWithDefaults(parsed: ParsedConfig): DisplayConfig {
  return {
    statusline: {
      emoji_safe_mode:
        parsed.statusline?.emoji_safe_mode
        ?? DEFAULT_DISPLAY_CONFIG.statusline.emoji_safe_mode
    },
    sprites: {
      color_mode:
        parsed.sprites?.color_mode
        ?? DEFAULT_DISPLAY_CONFIG.sprites.color_mode
    }
  };
}

/**
 * Reads display_config block from `wikis/_agents/CLAUDE.md`.
 *
 * Returns DEFAULT_DISPLAY_CONFIG silently on:
 *   - missing CLAUDE.md
 *   - missing fence
 *   - malformed YAML (logged to stderr; lint check surfaces this loudly)
 *   - schema validation failure (logged to stderr; lint check surfaces this)
 *
 * Partial blocks merge over defaults — missing nested keys keep their
 * default values.
 */
export function readDisplayConfig(vaultPath: string): DisplayConfig {
  const raw = readClaudeMdOrNull(vaultPath);
  if (raw === null) return DEFAULT_DISPLAY_CONFIG;

  const body = extractBody(raw);
  if (body === null) return DEFAULT_DISPLAY_CONFIG;

  let parsed: unknown;
  try {
    parsed = parseYamlBody(body);
  } catch (err) {
    process.stderr.write(
      `[display-config] failed to parse 'yaml display_config' block in wikis/_agents/CLAUDE.md; using defaults: ${(err as Error).message}\n`
    );
    return DEFAULT_DISPLAY_CONFIG;
  }

  const validated = ConfigSchema.safeParse(parsed);
  if (!validated.success) {
    const msgs = validated.error.issues
      .map(i => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    process.stderr.write(
      `[display-config] 'yaml display_config' block failed schema validation; using defaults: ${msgs}\n`
    );
    return DEFAULT_DISPLAY_CONFIG;
  }

  return mergeWithDefaults(validated.data);
}

/**
 * Lint-side helper: like `readDisplayConfig` but surfaces parse/validation
 * errors instead of swallowing them. Returns:
 *   - `null` if CLAUDE.md is missing OR the fence is absent (no error to flag)
 *   - `{ ok: true }` if the block parses + validates cleanly
 *   - `{ ok: false; reason }` if the YAML is malformed or fails schema validation
 *
 * Used by `core/lint-checks/display-config-block-invalid.ts` to emit a
 * `DISPLAY_CONFIG_BLOCK_INVALID` warning.
 */
export function validateDisplayConfigBlock(
  vaultPath: string
): { ok: true } | { ok: false; reason: string } | null {
  const raw = readClaudeMdOrNull(vaultPath);
  if (raw === null) return null;

  const body = extractBody(raw);
  if (body === null) return null;

  let parsed: unknown;
  try {
    parsed = parseYamlBody(body);
  } catch (err) {
    return {
      ok: false,
      reason: `failed to parse YAML in 'yaml display_config' fence in wikis/_agents/CLAUDE.md: ${(err as Error).message}`
    };
  }

  const validated = ConfigSchema.safeParse(parsed);
  if (!validated.success) {
    const msgs = validated.error.issues
      .map(i => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return {
      ok: false,
      reason: `'yaml display_config' fence in wikis/_agents/CLAUDE.md failed schema validation: ${msgs}`
    };
  }

  return { ok: true };
}
