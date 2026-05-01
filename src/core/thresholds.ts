import { readFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { z } from "zod";

/**
 * v1.6 §4.4 / §7.3 — fenced YAML threshold configuration parser.
 *
 * Reads `wikis/_agents/CLAUDE.md` and extracts the first fenced code block
 * whose info string starts with `yaml evolution_thresholds`. Returns parsed
 * thresholds, or null when the file or fence is absent. Throws
 * `ThresholdBlockError` when the fence body is malformed YAML or fails
 * schema validation.
 *
 * Defaults (v1.5 §7.3 lineage):
 *   basic_to_stage1:  tasks_completed=30, success_rate=0.80
 *   stage1_to_stage2: tasks_completed=100, success_rate=0.85
 */

export interface EvolutionThresholds {
  basic_to_stage1: { tasks_completed: number; success_rate: number };
  stage1_to_stage2: { tasks_completed: number; success_rate: number };
}

export const DEFAULT_THRESHOLDS: EvolutionThresholds = {
  basic_to_stage1: { tasks_completed: 30, success_rate: 0.80 },
  stage1_to_stage2: { tasks_completed: 100, success_rate: 0.85 },
};

export class ThresholdBlockError extends Error {
  public readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ThresholdBlockError";
    if (cause !== undefined) this.cause = cause;
  }
}

const stageSchema = z.object({
  tasks_completed: z.number().int().positive(),
  success_rate: z.number().min(0).max(1),
});

const thresholdsSchema = z.object({
  basic_to_stage1: stageSchema,
  stage1_to_stage2: stageSchema,
});

// Match the first fenced block whose info string is exactly `yaml evolution_thresholds`,
// optionally followed by whitespace + further tokens. Body is non-greedy.
const FENCE_RE = /^```yaml evolution_thresholds(?:[ \t][^\n]*)?\n([\s\S]*?)\n```/m;

export function readThresholds(vaultPath: string): EvolutionThresholds | null {
  const claudeMdPath = join(vaultPath, "wikis", "_agents", "CLAUDE.md");

  let raw: string;
  try {
    raw = readFileSync(claudeMdPath, "utf8");
  } catch (err: any) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) return null;
    throw err;
  }

  const match = raw.match(FENCE_RE);
  if (!match) return null;

  const body = match[1];

  let parsed: unknown;
  try {
    // Use gray-matter to parse the YAML body via its bundled js-yaml engine.
    // We wrap the body in frontmatter delimiters so `matter()` treats it as YAML.
    //
    // NOTE: passing the empty options object `{}` is deliberate. gray-matter
    // has a global content-keyed cache that's bypassed when ANY options arg is
    // supplied (lib/index.js: `if (!options) { ... cache code ... }`).
    // Without it, repeated reads with identical malformed bodies in a single
    // process would see the SECOND call return `data: {}` from cache instead
    // of re-throwing the YAML parse error — surfacing a misleading downstream
    // schema-validation error in place of the real parse error. v1.7 §5.7
    // mirrors the same fix already applied to core/display-config.ts.
    const wrapped = `---\n${body}\n---\n`;
    const result = matter(wrapped, {});
    parsed = result.data;
  } catch (err) {
    throw new ThresholdBlockError(
      `failed to parse YAML in 'yaml evolution_thresholds' fence in wikis/_agents/CLAUDE.md`,
      err
    );
  }

  const validated = thresholdsSchema.safeParse(parsed);
  if (!validated.success) {
    const msgs = validated.error.issues
      .map(i => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new ThresholdBlockError(
      `'yaml evolution_thresholds' fence in wikis/_agents/CLAUDE.md failed schema validation: ${msgs}`,
      validated.error
    );
  }

  return validated.data;
}
