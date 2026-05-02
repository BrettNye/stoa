import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCodeAdapter } from "../../src/core/runtime-adapters/claude-code.js";
import type { SubagentIntent } from "../../src/core/runtime-adapters/types.js";
import { MINIMAL_COORDINATION_TOOLSET } from "../../src/core/subagent-protocol.js";

let target: string;
let vaultPath: string;

const SAMPLE_INTENT: SubagentIntent = {
  id: "profile-charmander",
  pokemon_name: "charmander",
  pokemon_type: "fire",
  evolution_stage: "basic",
  routing_description: "Use when implementing async-task code with TDD discipline",
  system_prompt: "# Charmander\n\nBackend specialist.\n",
  moveset: [
    { id: "move-tdd-cycle", title: "TDD cycle", summary: "Red-green-refactor", applicability: "Any code change with measurable behavior" }
  ],
  tools_allowlist: [
    ...MINIMAL_COORDINATION_TOOLSET,
    "Bash", "Edit", "Read", "Grep",
  ],
  model_tier: "inherit",
  worktree_isolation: "recommended",
  applies_to: ["claude-code"],
  generated_at: "2026-05-02T00:00:00.000Z",
  source_revision: "abc1234",
};

beforeEach(() => {
  target = mkdtempSync(join(tmpdir(), "vault-cc-target-"));
  vaultPath = mkdtempSync(join(tmpdir(), "vault-cc-vault-"));
  mkdirSync(join(vaultPath, "_index"), { recursive: true });
});

afterEach(() => {
  rmSync(target, { recursive: true, force: true });
  rmSync(vaultPath, { recursive: true, force: true });
});

describe("claude-code adapter — validate (v1.7 §6.4 invariants 3 + 6)", () => {
  it("ok=true on a writable target with no settings.json", async () => {
    const r = await claudeCodeAdapter.validate(SAMPLE_INTENT, target);
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  it("hard-errors when applies_to does not include claude-code (invariant 3)", async () => {
    const intent: SubagentIntent = { ...SAMPLE_INTENT, applies_to: [] };
    const r = await claudeCodeAdapter.validate(intent, target);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.invariant === 3)).toBe(true);
  });

  it("warns when settings.json denies a coordination tool (invariant 6)", async () => {
    mkdirSync(join(target, ".claude"), { recursive: true });
    writeFileSync(
      join(target, ".claude", "settings.json"),
      JSON.stringify({
        permissions: { deny: ["mcp__vault__vault_channel-post"] }
      })
    );
    const r = await claudeCodeAdapter.validate(SAMPLE_INTENT, target);
    expect(r.ok).toBe(true); // warning is not a hard error
    expect(r.warnings.some(w => w.invariant === 6)).toBe(true);
    const w = r.warnings.find(x => x.invariant === 6)!;
    expect(JSON.stringify(w.context)).toContain("mcp__vault__vault_channel-post");
  });

  it("ok with no warnings when settings.json explicitly allows the toolset", async () => {
    mkdirSync(join(target, ".claude"), { recursive: true });
    writeFileSync(
      join(target, ".claude", "settings.json"),
      JSON.stringify({
        permissions: {
          allow: ["mcp__vault__vault_*", "Bash", "Edit", "Read", "Grep"],
          deny: []
        }
      })
    );
    const r = await claudeCodeAdapter.validate(SAMPLE_INTENT, target);
    expect(r.ok).toBe(true);
    expect(r.warnings).toHaveLength(0);
  });

  it("hard-errors when target path does not exist", async () => {
    const missing = join(target, "does", "not", "exist");
    const r = await claudeCodeAdapter.validate(SAMPLE_INTENT, missing);
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe("claude-code adapter — serialize (v1.7 §6.5)", () => {
  it("writes <target>/.claude/agents/<pokemon-id>.md (relative path)", () => {
    const files = claudeCodeAdapter.serialize(SAMPLE_INTENT);
    const keys = Object.keys(files);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBe(".claude/agents/profile-charmander.md");
  });

  it("frontmatter contains name, description, tools, model", () => {
    const files = claudeCodeAdapter.serialize(SAMPLE_INTENT);
    const content = files[".claude/agents/profile-charmander.md"];
    expect(content).toMatch(/^---\n/);
    expect(content).toContain("name: profile-charmander");
    expect(content).toContain("description:");
    expect(content).toContain("tools:");
    expect(content).toContain("model:");
  });

  it("tools list uses mcp__vault__vault_<name> for vault tools", () => {
    const files = claudeCodeAdapter.serialize(SAMPLE_INTENT);
    const content = files[".claude/agents/profile-charmander.md"];
    expect(content).toContain("mcp__vault__vault_channel-post");
    expect(content).toContain("mcp__vault__vault_task-claim");
    // Native tools unchanged.
    expect(content).toContain("- Bash");
    expect(content).toContain("- Edit");
  });

  it("body contains system prompt, protocol block, moveset section", () => {
    const files = claudeCodeAdapter.serialize(SAMPLE_INTENT);
    const content = files[".claude/agents/profile-charmander.md"];
    expect(content).toContain("Backend specialist");
    expect(content).toContain("## Channel/journal protocol");
    expect(content).toContain("vault.task-claim");
    expect(content).toContain("## Moveset");
    expect(content).toContain("### TDD cycle");
    expect(content).toContain("**When to use:**");
  });

  it("is idempotent (same intent → same content modulo generated_at)", () => {
    const a = claudeCodeAdapter.serialize(SAMPLE_INTENT);
    const b = claudeCodeAdapter.serialize(SAMPLE_INTENT);
    expect(a).toEqual(b);
  });
});

describe("claude-code adapter — deploy + verify + remove (v1.7 §6.4 invariants 4 + 5)", () => {
  it("deploy writes the agent def and records the deployment", async () => {
    const result = await claudeCodeAdapter.deploy(SAMPLE_INTENT, target, {
      mode: "copy", overwrite: true, registry_path: vaultPath
    });
    expect(result.status).toBe("deployed");
    const written = result.files_written[0];
    expect(existsSync(written)).toBe(true);
    const content = readFileSync(written, "utf8");
    expect(content).toContain("name: profile-charmander");
  });

  it("re-deploy with same source_revision returns skipped-no-change", async () => {
    await claudeCodeAdapter.deploy(SAMPLE_INTENT, target, {
      mode: "copy", overwrite: true, registry_path: vaultPath
    });
    const second = await claudeCodeAdapter.deploy(SAMPLE_INTENT, target, {
      mode: "copy", overwrite: true, registry_path: vaultPath
    });
    expect(second.status).toBe("skipped-no-change");
  });

  it("re-deploy with a newer source_revision overwrites and records the new rev", async () => {
    await claudeCodeAdapter.deploy(SAMPLE_INTENT, target, {
      mode: "copy", overwrite: true, registry_path: vaultPath
    });
    const newer: SubagentIntent = { ...SAMPLE_INTENT, source_revision: "def5678" };
    const second = await claudeCodeAdapter.deploy(newer, target, {
      mode: "copy", overwrite: true, registry_path: vaultPath
    });
    expect(second.status).toBe("deployed");
    expect(second.source_revision).toBe("def5678");
  });

  it("verify ok=true on freshly-deployed file", async () => {
    await claudeCodeAdapter.deploy(SAMPLE_INTENT, target, {
      mode: "copy", overwrite: true, registry_path: vaultPath
    });
    const v = await claudeCodeAdapter.verify(SAMPLE_INTENT, target);
    expect(v.ok).toBe(true);
    expect(v.violations).toHaveLength(0);
  });

  it("verify flags a missing coordination tool (invariant 1)", async () => {
    await claudeCodeAdapter.deploy(SAMPLE_INTENT, target, {
      mode: "copy", overwrite: true, registry_path: vaultPath
    });
    // Corrupt the on-disk file by removing one coordination tool.
    const path = join(target, ".claude", "agents", "profile-charmander.md");
    const raw = readFileSync(path, "utf8");
    const corrupted = raw.replace(/\s*-\s*mcp__vault__vault_channel-post\n/, "\n");
    writeFileSync(path, corrupted);
    const v = await claudeCodeAdapter.verify(SAMPLE_INTENT, target);
    expect(v.ok).toBe(false);
    expect(v.violations.some(x => x.invariant === 1)).toBe(true);
  });

  it("remove deletes the agent def + clears registry entry (invariant 4)", async () => {
    const dep = await claudeCodeAdapter.deploy(SAMPLE_INTENT, target, {
      mode: "copy", overwrite: true, registry_path: vaultPath
    });
    const r = await claudeCodeAdapter.remove(SAMPLE_INTENT, target);
    expect(r.files_removed).toContain(dep.files_written[0]);
    expect(existsSync(dep.files_written[0])).toBe(false);
  });
});
