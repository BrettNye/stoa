import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readThresholds,
  DEFAULT_THRESHOLDS,
  ThresholdBlockError,
} from "../../src/core/thresholds.js";

describe("thresholds", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-thresholds-"));
    mkdirSync(join(vaultPath, "wikis", "_agents"), { recursive: true });
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  function writeAgentsClaude(content: string): void {
    writeFileSync(join(vaultPath, "wikis", "_agents", "CLAUDE.md"), content, "utf8");
  }

  describe("DEFAULT_THRESHOLDS", () => {
    it("matches the v1.5 §7.3 defaults exactly", () => {
      expect(DEFAULT_THRESHOLDS).toEqual({
        basic_to_stage1: { tasks_completed: 30, success_rate: 0.80 },
        stage1_to_stage2: { tasks_completed: 100, success_rate: 0.85 },
      });
    });
  });

  describe("readThresholds", () => {
    it("returns null when wikis/_agents/CLAUDE.md does not exist", () => {
      // beforeEach created the directory but no CLAUDE.md
      expect(readThresholds(vaultPath)).toBeNull();
    });

    it("returns null when CLAUDE.md exists but has no yaml evolution_thresholds fence", () => {
      writeAgentsClaude(`# Agents

Some prose here.

\`\`\`yaml
unrelated: block
\`\`\`

More prose.

\`\`\`typescript
const x = 1;
\`\`\`
`);
      expect(readThresholds(vaultPath)).toBeNull();
    });

    it("parses a valid yaml evolution_thresholds fence", () => {
      writeAgentsClaude(`# Agents

Intro.

\`\`\`yaml evolution_thresholds
basic_to_stage1:
  tasks_completed: 25
  success_rate: 0.75
stage1_to_stage2:
  tasks_completed: 90
  success_rate: 0.9
\`\`\`

Trailing prose.
`);
      const result = readThresholds(vaultPath);
      expect(result).toEqual({
        basic_to_stage1: { tasks_completed: 25, success_rate: 0.75 },
        stage1_to_stage2: { tasks_completed: 90, success_rate: 0.9 },
      });
    });

    it("first matching fence wins when multiple are present", () => {
      writeAgentsClaude(`# Agents

\`\`\`yaml evolution_thresholds
basic_to_stage1:
  tasks_completed: 10
  success_rate: 0.5
stage1_to_stage2:
  tasks_completed: 50
  success_rate: 0.6
\`\`\`

Another (should be ignored):

\`\`\`yaml evolution_thresholds
basic_to_stage1:
  tasks_completed: 999
  success_rate: 0.99
stage1_to_stage2:
  tasks_completed: 999
  success_rate: 0.99
\`\`\`
`);
      const result = readThresholds(vaultPath);
      expect(result).toEqual({
        basic_to_stage1: { tasks_completed: 10, success_rate: 0.5 },
        stage1_to_stage2: { tasks_completed: 50, success_rate: 0.6 },
      });
    });

    it("throws ThresholdBlockError on invalid YAML inside the fence", () => {
      writeAgentsClaude(`# Agents

\`\`\`yaml evolution_thresholds
basic_to_stage1:
   tasks_completed: 30
  success_rate: 0.80
stage1_to_stage2:
  tasks_completed: 100
  success_rate: 0.85
\`\`\`
`);
      expect(() => readThresholds(vaultPath)).toThrow(ThresholdBlockError);
    });

    it("throws ThresholdBlockError when success_rate exceeds 1", () => {
      writeAgentsClaude(`# Agents

\`\`\`yaml evolution_thresholds
basic_to_stage1:
  tasks_completed: 30
  success_rate: 1.5
stage1_to_stage2:
  tasks_completed: 100
  success_rate: 0.85
\`\`\`
`);
      expect(() => readThresholds(vaultPath)).toThrow(ThresholdBlockError);
    });

    it("throws ThresholdBlockError when tasks_completed is negative", () => {
      writeAgentsClaude(`# Agents

\`\`\`yaml evolution_thresholds
basic_to_stage1:
  tasks_completed: -5
  success_rate: 0.8
stage1_to_stage2:
  tasks_completed: 100
  success_rate: 0.85
\`\`\`
`);
      expect(() => readThresholds(vaultPath)).toThrow(ThresholdBlockError);
    });

    it("throws ThresholdBlockError when basic_to_stage1 is missing", () => {
      writeAgentsClaude(`# Agents

\`\`\`yaml evolution_thresholds
stage1_to_stage2:
  tasks_completed: 100
  success_rate: 0.85
\`\`\`
`);
      expect(() => readThresholds(vaultPath)).toThrow(ThresholdBlockError);
    });

    it("accepts a fence with extra info-string suffix after evolution_thresholds", () => {
      writeAgentsClaude(`# Agents

\`\`\`yaml evolution_thresholds  trailing-comment
basic_to_stage1:
  tasks_completed: 20
  success_rate: 0.7
stage1_to_stage2:
  tasks_completed: 80
  success_rate: 0.8
\`\`\`
`);
      const result = readThresholds(vaultPath);
      expect(result).toEqual({
        basic_to_stage1: { tasks_completed: 20, success_rate: 0.7 },
        stage1_to_stage2: { tasks_completed: 80, success_rate: 0.8 },
      });
    });

    it("re-throws on identical malformed YAML across calls (no gray-matter cache poisoning)", () => {
      // v1.7 §5.7 regression — gray-matter has a global content-keyed cache
      // that's bypassed only when ANY options arg is supplied. Without
      // matter(input, {}), the FIRST call on malformed YAML throws (correct)
      // but populates the cache with a partially-initialized file object
      // (data: {}). A SECOND call on identical content returns that cached
      // entry directly, bypassing parseMatter — so the YAML parse error is
      // never re-raised; instead schema validation fires on the empty {}
      // and surfaces a different (downstream) error. With matter(input, {}),
      // the cache is bypassed entirely and every call re-parses, so
      // identical malformed bodies surface the SAME parse error every time.
      //
      // Mirrors the same regression locked in for core/display-config.ts
      // during v1.6 Phase 2 Wave 4.
      const malformed = `# Agents

\`\`\`yaml evolution_thresholds
basic_to_stage1:
   tasks_completed: 30
  success_rate: 0.80
stage1_to_stage2:
  tasks_completed: 100
  success_rate: 0.85
\`\`\`
`;
      writeAgentsClaude(malformed);

      // First call: must throw a parse-level ThresholdBlockError.
      let firstError: ThresholdBlockError | undefined;
      try {
        readThresholds(vaultPath);
      } catch (e) {
        firstError = e as ThresholdBlockError;
      }
      expect(firstError).toBeInstanceOf(ThresholdBlockError);
      expect(firstError!.message).toMatch(/failed to parse YAML/);

      // Rewrite identical content (same byte-for-byte body — this is the
      // gray-matter cache key). Without the cache-bypass fix, this second
      // call would NOT re-throw the parse error; matter() would return a
      // cached file with data: {}, which then fails schema validation —
      // surfacing a "failed schema validation" error instead of the
      // "failed to parse YAML" error.
      writeAgentsClaude(malformed);

      let secondError: ThresholdBlockError | undefined;
      try {
        readThresholds(vaultPath);
      } catch (e) {
        secondError = e as ThresholdBlockError;
      }
      expect(secondError).toBeInstanceOf(ThresholdBlockError);
      // Critical assertion: second call must surface the SAME parse error,
      // not a downstream schema-validation error caused by cache returning {}.
      expect(secondError!.message).toMatch(/failed to parse YAML/);
    });
  });
});
