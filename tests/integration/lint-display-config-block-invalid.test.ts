import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lintTool } from "../../src/tools/lint.js";

let vault: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-lint-dcbi-"));
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
    { level: "warning" as const },
    { vaultPath: vault }
  );
}

describe("DISPLAY_CONFIG_BLOCK_INVALID", () => {
  it("does not flag when wikis/_agents/CLAUDE.md is missing entirely", async () => {
    const r = await runLint();
    expect(r.diagnostics.some(d => d.code === "DISPLAY_CONFIG_BLOCK_INVALID")).toBe(false);
  });

  it("does not flag when CLAUDE.md exists but the fence is absent", async () => {
    writeFileSync(join(vault, "wikis", "_agents", "CLAUDE.md"),
      `# Agents wiki\n\nNo display_config block here.\n`);
    const r = await runLint();
    expect(r.diagnostics.some(d => d.code === "DISPLAY_CONFIG_BLOCK_INVALID")).toBe(false);
  });

  it("does not flag a valid display_config block", async () => {
    writeFileSync(join(vault, "wikis", "_agents", "CLAUDE.md"),
      "# Agents\n\n```yaml display_config\n" +
      "statusline:\n  emoji_safe_mode: true\n" +
      "sprites:\n  color_mode: ansi\n" +
      "```\n");
    const r = await runLint();
    expect(r.diagnostics.some(d => d.code === "DISPLAY_CONFIG_BLOCK_INVALID")).toBe(false);
  });

  it("flags malformed YAML inside the fence (severity warning)", async () => {
    writeFileSync(join(vault, "wikis", "_agents", "CLAUDE.md"),
      "# Agents\n\n```yaml display_config\n" +
      "statusline: { not closed\n" +
      "```\n");
    const r = await runLint();
    const d = r.diagnostics.find(x => x.code === "DISPLAY_CONFIG_BLOCK_INVALID");
    expect(d).toBeDefined();
    expect(d?.severity).toBe("warning");
    expect(d?.message).toMatch(/wikis\/_agents\/CLAUDE\.md/);
  });

  it("flags wrong type (e.g., color_mode: 42) (severity warning)", async () => {
    writeFileSync(join(vault, "wikis", "_agents", "CLAUDE.md"),
      "# Agents\n\n```yaml display_config\n" +
      "sprites:\n  color_mode: 42\n" +
      "```\n");
    const r = await runLint();
    const d = r.diagnostics.find(x => x.code === "DISPLAY_CONFIG_BLOCK_INVALID");
    expect(d).toBeDefined();
    expect(d?.severity).toBe("warning");
    expect(d?.message).toMatch(/wikis\/_agents\/CLAUDE\.md/);
  });

  it("flags an out-of-enum color_mode value", async () => {
    writeFileSync(join(vault, "wikis", "_agents", "CLAUDE.md"),
      "# Agents\n\n```yaml display_config\n" +
      "sprites:\n  color_mode: rainbow\n" +
      "```\n");
    const r = await runLint();
    const d = r.diagnostics.find(x => x.code === "DISPLAY_CONFIG_BLOCK_INVALID");
    expect(d).toBeDefined();
    expect(d?.severity).toBe("warning");
  });

  it("references wikis/_agents/CLAUDE.md so the operator knows where to look", async () => {
    writeFileSync(join(vault, "wikis", "_agents", "CLAUDE.md"),
      "```yaml display_config\n" +
      "statusline:\n  emoji_safe_mode: \"not-a-bool\"\n" +
      "```\n");
    const r = await runLint();
    const d = r.diagnostics.find(x => x.code === "DISPLAY_CONFIG_BLOCK_INVALID");
    expect(d).toBeDefined();
    expect(d?.message).toMatch(/wikis\/_agents\/CLAUDE\.md/);
  });
});
