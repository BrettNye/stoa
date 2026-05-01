import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lintTool } from "../../src/tools/lint.js";

let vault: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-lint-tbi-"));
  // Minimal vault skeleton: _index dir + an _agents wiki with map.md so
  // unrelated MISSING_MAP diagnostics don't pollute these assertions.
  mkdirSync(join(vault, "_index"), { recursive: true });
  mkdirSync(join(vault, "wikis", "_agents"), { recursive: true });
  writeFileSync(join(vault, "wikis", "_agents", "map.md"),
    `---
id: map-_agents
title: agents
type: map
wiki: _agents
status: active
created: 2026-04-30
updated: 2026-04-30
summary: m
---
`);
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

async function runLint() {
  return await lintTool.handler(
    { level: "error" as const },
    { vaultPath: vault }
  );
}

describe("THRESHOLD_BLOCK_INVALID", () => {
  it("flags out-of-range numeric values (success_rate > 1)", async () => {
    writeFileSync(join(vault, "wikis", "_agents", "CLAUDE.md"),
      `# Agents

\`\`\`yaml evolution_thresholds
basic_to_stage1:
  tasks_completed: 30
  success_rate: 1.5
stage1_to_stage2:
  tasks_completed: 100
  success_rate: 0.85
\`\`\`
`);
    const r = await runLint();
    const d = r.diagnostics.find(x => x.code === "THRESHOLD_BLOCK_INVALID");
    expect(d).toBeDefined();
    expect(d?.severity).toBe("error");
    // The message should surface the parser's specific complaint so the
    // operator can fix it without re-parsing.
    expect(d?.message).toMatch(/success_rate/);
  });

  it("flags malformed YAML inside the fence", async () => {
    writeFileSync(join(vault, "wikis", "_agents", "CLAUDE.md"),
      `# Agents

\`\`\`yaml evolution_thresholds
basic_to_stage1: { not closed
\`\`\`
`);
    const r = await runLint();
    const d = r.diagnostics.find(x => x.code === "THRESHOLD_BLOCK_INVALID");
    expect(d).toBeDefined();
    expect(d?.severity).toBe("error");
    expect(d?.message).toMatch(/wikis\/_agents\/CLAUDE\.md/);
  });

  it("does not flag a valid threshold block", async () => {
    writeFileSync(join(vault, "wikis", "_agents", "CLAUDE.md"),
      `# Agents

\`\`\`yaml evolution_thresholds
basic_to_stage1:
  tasks_completed: 25
  success_rate: 0.75
stage1_to_stage2:
  tasks_completed: 90
  success_rate: 0.90
\`\`\`
`);
    const r = await runLint();
    expect(r.diagnostics.some(d => d.code === "THRESHOLD_BLOCK_INVALID")).toBe(false);
  });

  it("does not flag when the fence is absent (no block configured)", async () => {
    writeFileSync(join(vault, "wikis", "_agents", "CLAUDE.md"),
      `# Agents wiki

No threshold block here — operator hasn't customized.
`);
    const r = await runLint();
    expect(r.diagnostics.some(d => d.code === "THRESHOLD_BLOCK_INVALID")).toBe(false);
  });

  it("does not flag when wikis/_agents/CLAUDE.md is missing entirely", async () => {
    // The beforeEach sets up the wiki dir but no CLAUDE.md.
    const r = await runLint();
    expect(r.diagnostics.some(d => d.code === "THRESHOLD_BLOCK_INVALID")).toBe(false);
  });

  it("references wikis/_agents/CLAUDE.md so the operator knows where to look", async () => {
    writeFileSync(join(vault, "wikis", "_agents", "CLAUDE.md"),
      `\`\`\`yaml evolution_thresholds
basic_to_stage1:
  tasks_completed: 30
  success_rate: 2
stage1_to_stage2:
  tasks_completed: 100
  success_rate: 0.85
\`\`\`
`);
    const r = await runLint();
    const d = r.diagnostics.find(x => x.code === "THRESHOLD_BLOCK_INVALID");
    expect(d).toBeDefined();
    // page_id may be absent (CLAUDE.md isn't a typed page), but the message
    // must point at the file path so the diagnostic is actionable.
    expect(d?.message).toMatch(/wikis\/_agents\/CLAUDE\.md/);
  });
});
