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
  });
});
